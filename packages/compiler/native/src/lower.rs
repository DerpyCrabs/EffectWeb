//! Lower snapshot JSX to calls into the existing DOM runtime.
//! Oxc bindings identify dependencies; ordinary source expressions retain their lexical syntax.
use crate::analysis::{Index, contains_jsx};
use oxc::{
    ast::ast::*,
    span::{GetSpan, Span},
    syntax::symbol::SymbolId,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub import_source: Option<String>,
    pub runtime_module: Option<String>,
    #[serde(default)]
    pub development: bool,
}
#[derive(Serialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub message: String,
}
#[derive(Clone)]
enum Value<'a> {
    Read(String),
    Template(&'a Expression<'a>),
}
type Env<'a> = BTreeMap<SymbolId, Value<'a>>;
type Result<T> = std::result::Result<T, String>;
fn quote(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}
fn unwrapped<'a>(mut e: &'a Expression<'a>) -> &'a Expression<'a> {
    loop {
        e = match e {
            Expression::TSAsExpression(x) => &x.expression,
            Expression::TSSatisfiesExpression(x) => &x.expression,
            Expression::TSNonNullExpression(x) => &x.expression,
            Expression::ParenthesizedExpression(x) => &x.expression,
            _ => return e,
        }
    }
}
fn returns(lines: &[&Statement<'_>]) -> bool {
    lines.iter().any(|s| match s {
        Statement::ReturnStatement(_) => true,
        Statement::BlockStatement(b) => returns(&b.body.iter().collect::<Vec<_>>()),
        Statement::IfStatement(i) => i
            .alternate
            .as_ref()
            .is_some_and(|a| returns(&[&i.consequent]) && returns(&[a])),
        Statement::SwitchStatement(s) => {
            s.cases.iter().any(|c| c.test.is_none())
                && s.cases.iter().enumerate().all(|(i, c)| {
                    if c.consequent.is_empty() {
                        i + 1 < s.cases.len()
                    } else {
                        returns(&c.consequent.iter().collect::<Vec<_>>())
                    }
                })
        }
        _ => false,
    })
}
fn lines<'a>(s: &'a Statement<'a>) -> Vec<&'a Statement<'a>> {
    if let Statement::BlockStatement(b) = s {
        b.body.iter().collect()
    } else {
        vec![s]
    }
}

pub struct Lower<'a, 's> {
    pub source: &'a str,
    pub filename: &'a str,
    pub index: &'s Index<'a, 's>,
    pub options: &'s Options,
    pub diagnostics: Vec<Diagnostic>,
    pub hoisted: Vec<String>,
    pub runtime: String,
    pub slot_markers: HashSet<SymbolId>,
    prefix: String,
    map_prefix: String,
    counter: usize,
    inside_static: bool,
    depth: usize,
}
impl<'a, 's> Lower<'a, 's> {
    pub fn new(
        source: &'a str,
        filename: &'a str,
        index: &'s Index<'a, 's>,
        options: &'s Options,
    ) -> Self {
        let mut prefix = "_tv_".to_string();
        while source.contains(&prefix) {
            prefix.push('_');
        }
        let runtime = format!("{prefix}dom");
        Self {
            source,
            filename,
            index,
            options,
            diagnostics: vec![],
            hoisted: vec![],
            runtime,
            slot_markers: HashSet::new(),
            prefix,
            map_prefix: crate::sourcemap::marker_prefix(source),
            counter: 0,
            inside_static: false,
            depth: 0,
        }
    }
    fn uid(&mut self, hint: &str) -> String {
        self.counter += 1;
        format!("{}{}_{}", self.prefix, hint, self.counter)
    }
    fn raw(&self, s: Span) -> &str {
        &self.source[s.start as usize..s.end as usize]
    }
    fn marker(&self, s: Span) -> String {
        format!("{}{}__*/", self.map_prefix, s.start)
    }
    pub fn fail<T>(&self, span: Span, message: &str) -> Result<T> {
        let head = &self.source[..span.start as usize];
        let line = head.bytes().filter(|&b| b == b'\n').count() + 1;
        let col = head
            .rsplit('\n')
            .next()
            .unwrap_or("")
            .encode_utf16()
            .count()
            + 1;
        Err(format!(
            "{}:{line}:{col}: Snapshot JSX: {message}\n> {line} | {}",
            self.filename,
            self.source.lines().nth(line - 1).unwrap_or("")
        ))
    }
    fn is_template(&self, e: &Expression<'a>, env: &Env<'a>, depth: usize) -> bool {
        depth < 100
            && (contains_jsx(e)
                || self.index.references(e.span()).any(|r| {
                    r.symbol
                        .and_then(|id| env.get(&id))
                        .is_some_and(|v| matches!(v, Value::Template(_)))
                }))
    }
    fn slot_function(
        &self,
        e: &'a Expression<'a>,
    ) -> Result<Option<&'a ArrowFunctionExpression<'a>>> {
        let Expression::CallExpression(call) = unwrapped(e) else {
            return Ok(None);
        };
        let Expression::Identifier(id) = unwrapped(&call.callee) else {
            return Ok(None);
        };
        if !self
            .index
            .symbol(id)
            .is_some_and(|id| self.slot_markers.contains(&id))
        {
            return Ok(None);
        }
        if call.arguments.len() != 1 {
            return self.fail(call.span, "slot() takes one synchronous markup callback.");
        }
        let Some(Expression::ArrowFunctionExpression(f)) = call.arguments[0].as_expression() else {
            return self.fail(call.span, "slot() takes one synchronous markup callback.");
        };
        if f.r#async
            || f.params.items.len() > 1
            || f.params.rest.is_some()
            || f.params.items.iter().any(|p| {
                !matches!(p.pattern, BindingPattern::BindingIdentifier(_))
                    || p.initializer.is_some()
            })
        {
            return self.fail(
                call.span,
                "Slots take at most one named value parameter; destructure inside the callback.",
            );
        }
        Ok(Some(f))
    }
    fn slot_value(&mut self, e: &'a Expression<'a>, env: &Env<'a>, owner: &str) -> Result<String> {
        let scope = self.uid("slot");
        let parent = self.uid("parent");
        let before = self.uid("before");
        let mut local = env.clone();
        let body = if let Some(f) = self.slot_function(e)? {
            if let Some(param) = f.params.items.first()
                && let BindingPattern::BindingIdentifier(id) = &param.pattern
            {
                local.insert(
                    id.symbol_id.get().unwrap(),
                    Value::Read(format!("{scope}.value")),
                );
            }
            self.function_body(&f.body, &local, &scope, &parent, &before)?
        } else {
            self.render(e, &local, &scope, &parent, &before)?
        };
        Ok(format!(
            "{}.compiledSlot({owner},({scope},{parent},{before})=>{{{body}}})",
            self.runtime
        ))
    }
    fn rewrite(&self, e: &Expression<'a>, env: &Env<'a>) -> String {
        self.rewrite_span(e.span(), env, 0)
    }
    fn rewrite_span(&self, span: Span, env: &Env<'a>, depth: usize) -> String {
        if depth > 100 {
            return "undefined".into();
        }
        let mut out = String::new();
        let mut offset = span.start as usize;
        for r in self.index.references(span) {
            let Some(v) = r.symbol.and_then(|id| env.get(&id)) else {
                continue;
            };
            let value = match v {
                Value::Read(v) => v.clone(),
                Value::Template(t) => self.rewrite_span(t.span(), env, depth + 1),
            };
            out.push_str(&self.source[offset..r.span.start as usize]);
            if r.shorthand {
                out.push_str(&format!("{}: ", r.name));
            }
            out.push('(');
            out.push_str(&value);
            out.push(')');
            offset = r.span.end as usize;
        }
        out.push_str(&self.source[offset..span.end as usize]);
        out
    }
    fn captures(&self, e: &Expression<'a>, env: &Env<'a>) -> Vec<SymbolId> {
        let mut seen = HashSet::new();
        self.index
            .references(e.span())
            .filter_map(|r| {
                r.symbol
                    .filter(|id| matches!(env.get(id), Some(Value::Read(_))) && seen.insert(*id))
            })
            .collect()
    }
    fn snapshot(&mut self, e: &Expression<'a>, env: &Env<'a>) -> String {
        let ids = self.captures(e, env);
        if ids.is_empty() {
            return self.rewrite(e, env);
        }
        let mut local = env.clone();
        let mut args = vec![];
        let mut params = vec![];
        for id in ids {
            let p = self.uid("capture");
            if let Some(Value::Read(value)) = env.get(&id) {
                args.push(value.clone());
            }
            local.insert(id, Value::Read(p.clone()));
            params.push(p);
        }
        format!(
            "(({})=>({}))({})",
            params.join(","),
            self.rewrite(e, &local),
            args.join(",")
        )
    }
    fn deps(&self, e: &Expression<'a>, env: &Env<'a>) -> Vec<String> {
        self.deps_inner(e, env, 0)
    }
    fn deps_inner(&self, e: &Expression<'a>, env: &Env<'a>, depth: usize) -> Vec<String> {
        if depth > 100 {
            return vec![];
        }
        let mut found = vec![];
        let mut seen = HashSet::new();
        for r in self.index.references(e.span()) {
            let values = match r.symbol.and_then(|id| env.get(&id)) {
                Some(Value::Read(value)) => vec![if r.path.is_empty() {
                    value.clone()
                } else {
                    format!("({value}){}", r.path.join(""))
                }],
                Some(Value::Template(t)) => self.deps_inner(t, env, depth + 1),
                None => vec![],
            };
            for value in values {
                if seen.insert(value.clone()) {
                    found.push(value);
                }
            }
        }
        found
    }
    fn diagnostic(&mut self, e: &Expression<'a>, env: &Env<'a>) -> String {
        if !self.options.development {
            return String::new();
        }
        let mut labels = vec![];
        for r in self.index.references(e.span()) {
            if r.symbol.is_some_and(|id| env.contains_key(&id)) && !labels.contains(&r.label) {
                labels.push(r.label.clone());
            }
        }
        let span = e.span();
        let head = &self.source[..span.start as usize];
        let line = head.bytes().filter(|&b| b == b'\n').count() + 1;
        let column = head
            .rsplit('\n')
            .next()
            .unwrap_or("")
            .encode_utf16()
            .count()
            + 1;
        if matches!(unwrapped(e), Expression::CallExpression(_))
            && self.index.references(span).any(|r| {
                r.path.is_empty()
                    && r.symbol.is_some_and(
                        |id| matches!(env.get(&id),Some(Value::Read(v)) if v.ends_with(".value")),
                    )
            })
        {
            self.diagnostics.push(Diagnostic{file:self.filename.into(),line,column,message:"This call depends on the whole model. Pass the fields it uses to avoid recomputing on unrelated changes.".into()});
        }
        format!(
            ",{}",
            serde_json::json!({"file":self.filename,"line":line,"column":column,"expression":self.raw(span),"dependencies":labels})
        )
    }
    pub fn compile_view(&mut self, call: &'a CallExpression<'a>) -> Result<String> {
        let Some(Expression::ArrowFunctionExpression(f)) =
            call.arguments.first().and_then(|a| a.as_expression())
        else {
            return self.fail(call.span,"view((model, send) => JSX) requires two named parameters and a synchronous pure body.");
        };
        if f.r#async
            || f.params.items.len() != 2
            || f.params.rest.is_some()
            || f.params.items.iter().any(|p| {
                !matches!(p.pattern, BindingPattern::BindingIdentifier(_))
                    || p.initializer.is_some()
            })
        {
            return self.fail(call.span,"view((model, send) => JSX) requires two named parameters and a synchronous pure body.");
        }
        for (span, message) in &self.index.violations {
            if span.start >= f.span.start && span.end <= f.span.end {
                return self.fail(*span, message);
            }
        }
        for r in self.index.references(f.span) {
            if let Some(id) = r.symbol {
                let flags = self.index.scoping.symbol_flags(id);
                let declaration = self.index.scoping.symbol_span(id);
                if flags.is_const_variable()
                    && r.span.start < declaration.start
                    && declaration.start >= f.span.start
                    && declaration.end <= f.span.end
                {
                    return self.fail(r.span,"Declare view constants before helpers that reference them. Forward captures are unsupported.");
                }
                if (flags.is_variable()
                    && !flags.is_const_variable()
                    && !flags.is_function_scoped_declaration())
                    || self.index.scoping.symbol_is_mutated(id)
                {
                    return self.fail(r.span,&format!("Mutable capture {} is not a model dependency. Pass immutable data through the model.",r.name));
                }
            } else if [
                "window",
                "document",
                "Date",
                "localStorage",
                "sessionStorage",
            ]
            .contains(&r.name.as_str())
                && !(r.name == "Date" && r.safe_date)
            {
                return self.fail(
                    r.span,
                    &format!(
                        "Read {} in a command or DOM host, then put its result in the model.",
                        r.name
                    ),
                );
            }
        }
        let scope = self.uid("scope");
        let parent = self.uid("parent");
        let before = self.uid("before");
        let mut env = Env::new();
        for (p, field) in f.params.items.iter().zip(["value", "send"]) {
            if let BindingPattern::BindingIdentifier(id) = &p.pattern {
                env.insert(
                    id.symbol_id.get().unwrap(),
                    Value::Read(format!("{scope}.{field}")),
                );
            }
        }
        let body = self.function_body(&f.body, &env, &scope, &parent, &before)?;
        Ok(format!(
            "{}{}.compiled(({scope},{parent},{before})=>{{{body}}})",
            self.marker(call.span),
            self.runtime
        ))
    }
    fn function_body(
        &mut self,
        b: &'a ArrowFunctionBody<'a>,
        env: &Env<'a>,
        scope: &str,
        parent: &str,
        before: &str,
    ) -> Result<String> {
        if let ArrowFunctionBody::FunctionBody(b) = b {
            self.statements(
                &b.statements.iter().collect::<Vec<_>>(),
                env,
                scope,
                parent,
                before,
            )
        } else {
            self.render(b.as_expression().unwrap(), env, scope, parent, before)
        }
    }
    fn statements(
        &mut self,
        body: &[&'a Statement<'a>],
        env: &Env<'a>,
        scope: &str,
        parent: &str,
        before: &str,
    ) -> Result<String> {
        let mut env = env.clone();
        let mut output = String::new();
        for (index, line) in body.iter().enumerate() {
            output.push_str(&self.marker(line.span()));
            match line {
                Statement::ReturnStatement(r) => {
                    if index + 1 != body.len() {
                        return self.fail(body[index + 1].span(), "Remove unreachable statements after a view return.");
                    }
                    if let Some(e) = &r.argument {
                        output.push_str(&self.render(e, &env, scope, parent, before)?);
                    }
                    return Ok(output);
                }
                Statement::VariableDeclaration(d) if d.kind == VariableDeclarationKind::Const => {
                    for decl in &d.declarations {
                        let Some(init) = &decl.init else {
                            return self.fail(decl.span, "View constants need initializers.");
                        };
                        if self.slot_function(init)?.is_some() {
                            let BindingPattern::BindingIdentifier(id) = &decl.id else { return self.fail(decl.span, "Bind slots to a named constant."); };
                            let name = self.uid("content");
                            let value = self.slot_value(init, &env, scope)?;
                            output.push_str(&format!("const {name}={value};"));
                            env.insert(id.symbol_id.get().unwrap(), Value::Read(name));
                        } else if self.is_template(init, &env, 0) {
                            if let BindingPattern::BindingIdentifier(id) = &decl.id {
                                let symbol = id.symbol_id.get().unwrap();
                                if self.index.references(init.span()).any(|r| r.symbol == Some(symbol)) {
                                    return self.fail(init.span(), "Recursive JSX helpers are unsupported.");
                                }
                                env.insert(symbol, Value::Template(init));
                            } else {
                                return self.fail(decl.span, "Destructure data, not JSX templates.");
                            }
                        } else {
                            let cached = self.uid("derived");
                            let deps = self.deps(init, &env).join(",");
                            let value = self.snapshot(init, &env);
                            let diagnostic = self.diagnostic(init, &env);
                            output.push_str(&format!("const {cached}={scope}.derive(()=>[{deps}],()=>({value}){diagnostic});"));
                            // Rewrite defaults/computed keys before adding the pattern's own bindings.
                            let pattern = self.rewrite_span(decl.id.span(), &env, 0);
                            for (id, name) in self.index.binding_names(decl.id.span()) {
                                let read = if matches!(decl.id, BindingPattern::BindingIdentifier(_)) {
                                    format!("{cached}()")
                                } else {
                                    format!("(({pattern})=>{name})({cached}())")
                                };
                                env.insert(id, Value::Read(read));
                            }
                        }
                    }
                }
                Statement::IfStatement(i) => {
                    let tail = &body[index + 1..];
                    let mut yes = lines(&i.consequent);
                    if !returns(&yes) { yes.extend_from_slice(tail); }
                    let mut no = i.alternate.as_ref().map(lines).unwrap_or_default();
                    if !returns(&no) { no.extend_from_slice(tail); }
                    let p = self.uid("parent");
                    let b = self.uid("before");
                    let condition = self.rewrite(&i.test, &env);
                    let yes = self.statements(&yes, &env, scope, &p, &b)?;
                    let no = self.statements(&no, &env, scope, &p, &b)?;
                    output.push_str(&format!("{}.branch({scope},{parent},{before},()=>({condition}),({scope},{p},{b})=>{{{yes}}},({scope},{p},{b})=>{{{no}}});", self.runtime));
                    return Ok(output);
                }
                Statement::BlockStatement(b) => {
                    let mut block: Vec<_> = b.body.iter().collect();
                    if !returns(&block) { block.extend_from_slice(&body[index + 1..]); }
                    output.push_str(&self.statements(&block, &env, scope, parent, before)?);
                    return Ok(output);
                }
                Statement::SwitchStatement(s) => {
                    output.push_str(&self.switch(s, &body[index + 1..], &env, scope, parent, before)?);
                    return Ok(output);
                }
                _ => return self.fail(line.span(), "Views contain pure const declarations, if/else, returning switch cases and returns. Put state changes and work in update/commands."),
            }
        }
        self.fail(
            body.last().map(|s| s.span()).unwrap_or(Span::new(0, 0)),
            "Every view path needs a return. Return null to render nothing.",
        )
    }
    fn switch(
        &mut self,
        s: &'a SwitchStatement<'a>,
        tail: &[&'a Statement<'a>],
        env: &Env<'a>,
        scope: &str,
        parent: &str,
        before: &str,
    ) -> Result<String> {
        let mut groups: Vec<(Vec<&Expression<'_>>, bool, Vec<&Statement<'_>>)> = vec![];
        let mut tests = vec![];
        let mut default = false;
        for case in &s.cases {
            if let Some(t) = &case.test {
                tests.push(t)
            } else {
                default = true
            };
            if case.consequent.is_empty() {
                continue;
            }
            let body = case.consequent.iter().collect::<Vec<_>>();
            if !returns(&body) {
                return self.fail(case.span,"Switch cases must return on every path. Group empty labels; break and statement fallthrough are unsupported.");
            }
            groups.push((std::mem::take(&mut tests), default, body));
            default = false;
        }
        if !tests.is_empty() || default {
            return self.fail(s.span, "Switch labels need a returning case body.");
        }
        let selected = self.uid("selected");
        let chosen = self.uid("case");
        let deps = self.deps(&s.discriminant, env).join(",");
        let disc = self.snapshot(&s.discriminant, env);
        let fallback = groups.iter().position(|g| g.1);
        let mut choice = fallback
            .map(|i| i.to_string())
            .unwrap_or_else(|| "-1".into());
        let mut case_deps = vec![format!("{selected}()")];
        for (i, (tests, _, _)) in groups.iter().enumerate().rev() {
            if !tests.is_empty() {
                let mut conditions = vec![];
                for t in tests {
                    case_deps.extend(self.deps(t, env));
                    conditions.push(format!("{selected}()===({})", self.rewrite(t, env)));
                }
                choice = format!("{}?{i}:({choice})", conditions.join("||"));
            }
        }
        let p = self.uid("parent");
        let b = self.uid("before");
        let mut alt = self.statements(
            fallback.map(|i| groups[i].2.as_slice()).unwrap_or(tail),
            env,
            scope,
            &p,
            &b,
        )?;
        for (i, (_, is_default, body)) in groups.iter().enumerate().rev() {
            if *is_default {
                continue;
            }
            let yes = self.statements(body, env, scope, &p, &b)?;
            alt = format!(
                "{}.branch({scope},{p},{b},()=>{chosen}()==={i},({scope},{p},{b})=>{{{yes}}},({scope},{p},{b})=>{{{alt}}});",
                self.runtime
            );
        }
        // Each case has a stable scope; all grouped labels select the same case index.
        Ok(format!(
            "const {selected}={scope}.derive(()=>[{deps}],()=>({disc}));const {chosen}={scope}.derive(()=>[{}],()=>({choice}));(({p},{b})=>{{{alt}}})({parent},{before});",
            case_deps.join(",")
        ))
    }
    fn template_target(&self, mut expr: &'a Expression<'a>, env: &Env<'a>) -> &'a Expression<'a> {
        for _ in 0..100 {
            expr = unwrapped(expr);
            if let Expression::Identifier(id) = expr
                && let Some(Value::Template(t)) = self.index.symbol(id).and_then(|id| env.get(&id))
            {
                expr = t;
                continue;
            }
            break;
        }
        expr
    }
    fn render(
        &mut self,
        node: &'a Expression<'a>,
        env: &Env<'a>,
        scope: &str,
        parent: &str,
        before: &str,
    ) -> Result<String> {
        self.depth += 1;
        if self.depth > 200 {
            return self.fail(node.span(), "Recursive JSX helpers are unsupported.");
        }
        let result = self.render_inner(unwrapped(node), env, scope, parent, before);
        self.depth -= 1;
        result
    }
    fn render_inner(
        &mut self,
        node: &'a Expression<'a>,
        env: &Env<'a>,
        scope: &str,
        parent: &str,
        before: &str,
    ) -> Result<String> {
        let mark = self.marker(node.span());
        if let Expression::Identifier(id) = node
            && let Some(Value::Template(t)) = self.index.symbol(id).and_then(|id| env.get(&id))
        {
            return self.render(t, env, scope, parent, before);
        }
        if let Expression::CallExpression(call) = node {
            let callee = unwrapped(&call.callee);
            let template = if let Expression::Identifier(id) = callee {
                match self.index.symbol(id).and_then(|id| env.get(&id)) {
                    Some(Value::Template(t)) => Some(self.template_target(t, env)),
                    _ => None,
                }
            } else {
                Some(callee)
            };
            if let Some(Expression::ArrowFunctionExpression(f)) = template
                && self.is_template(template.unwrap(), env, 0)
            {
                if f.params.rest.is_some()
                    || f.params.items.iter().any(|p| {
                        !matches!(p.pattern, BindingPattern::BindingIdentifier(_))
                            || p.initializer.is_some()
                    })
                    || call.arguments.iter().any(|a| a.as_expression().is_none())
                {
                    return self.fail(
                        node.span(),
                        "JSX helper calls take named parameters and ordinary arguments.",
                    );
                }
                let inner = self.uid("arguments");
                let p = self.uid("parent");
                let b = self.uid("before");
                let mut local = env.clone();
                for (index, param) in f.params.items.iter().enumerate() {
                    if let BindingPattern::BindingIdentifier(id) = &param.pattern {
                        local.insert(
                            id.symbol_id.get().unwrap(),
                            Value::Read(format!("{inner}.value[{index}]")),
                        );
                    }
                }
                let outer = self.deps(template.unwrap(), env);
                let mut deps = vec![];
                let mut args = vec![];
                for arg in &call.arguments {
                    let arg = arg.as_expression().unwrap();
                    deps.extend(self.deps(arg, env));
                    args.push(self.rewrite(arg, env));
                }
                // Missing JS arguments remain undefined; outer dependencies must not occupy parameter slots.
                while args.len() < f.params.items.len() {
                    args.push("undefined".into())
                }
                args.extend(outer.clone());
                deps.extend(outer);
                let body = self.function_body(&f.body, &local, &inner, &p, &b)?;
                return Ok(format!(
                    "{mark}{}.invoke({scope},{parent},{before},()=>[{}],()=>[{}],({inner},{p},{b})=>{{{body}}});",
                    self.runtime,
                    deps.join(","),
                    args.join(",")
                ));
            }
            if let Expression::StaticMemberExpression(m) = callee
                && m.property.name == "map"
                && call.arguments.len() == 1
                && let Some(Expression::ArrowFunctionExpression(f)) =
                    call.arguments[0].as_expression()
            {
                if f.r#async
                    || f.params.items.is_empty()
                    || f.params.items.len() > 2
                    || f.params.rest.is_some()
                    || f.params.items.iter().any(|p| {
                        !matches!(p.pattern, BindingPattern::BindingIdentifier(_))
                            || p.initializer.is_some()
                    })
                {
                    return self.fail(node.span(),"List callbacks take item and optional index identifiers. Destructure inside the callback.");
                }
                let row = self.uid("row");
                let p = self.uid("parent");
                let b = self.uid("before");
                let mut local = env.clone();
                for (i, param) in f.params.items.iter().enumerate() {
                    if let BindingPattern::BindingIdentifier(id) = &param.pattern {
                        local.insert(
                            id.symbol_id.get().unwrap(),
                            Value::Read(format!("{row}.value[{i}]")),
                        );
                    }
                }
                let source = self.rewrite(&m.object, env);
                let deps = self
                    .deps(call.arguments[0].as_expression().unwrap(), env)
                    .join(",");
                let indexed = f.params.items.len() == 2;
                let body = self.function_body(&f.body, &local, &row, &p, &b)?;
                return Ok(format!(
                    "{mark}{}.each({scope},{parent},{before},()=>({source}),()=>[{deps}],{indexed},({row},{p},{b})=>{{{body}}});",
                    self.runtime
                ));
            }
        }
        match node {
            Expression::JSXElement(e) => self.element(e, env, scope, parent, before),
            Expression::JSXFragment(f) => self.children(&f.children, env, scope, parent, before),
            Expression::ConditionalExpression(c) => {
                let p = self.uid("parent");
                let b = self.uid("before");
                let condition = self.rewrite(&c.test, env);
                let yes = self.render(&c.consequent, env, scope, &p, &b)?;
                let no = self.render(&c.alternate, env, scope, &p, &b)?;
                Ok(format!(
                    "{mark}{}.branch({scope},{parent},{before},()=>({condition}),({scope},{p},{b})=>{{{yes}}},({scope},{p},{b})=>{{{no}}});",
                    self.runtime
                ))
            }
            Expression::LogicalExpression(c) if c.operator.as_str() == "&&" => {
                let p = self.uid("parent");
                let b = self.uid("before");
                let condition = self.rewrite(&c.left, env);
                let yes = self.render(&c.right, env, scope, &p, &b)?;
                Ok(format!(
                    "{mark}{}.branch({scope},{parent},{before},()=>({condition}),({scope},{p},{b})=>{{{yes}}},({scope},{p},{b})=>{{}});",
                    self.runtime
                ))
            }
            Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => Ok(String::new()),
            Expression::StringLiteral(s) => Ok(format!(
                "{mark}{}.literal({parent},{before},{});",
                self.runtime,
                quote(s.value.as_str())
            )),
            Expression::NumericLiteral(n) => Ok(format!(
                "{mark}{}.literal({parent},{before},{});",
                self.runtime,
                quote(&n.value.to_string())
            )),
            _ => {
                if self.is_template(node, env, 0) {
                    return self.fail(node.span(),"Unsupported JSX expression. Use a conditional, collection.map(), or a named compiled child view.");
                }
                let deps = self.deps(node, env).join(",");
                let value = self.rewrite(node, env);
                let diagnostic = self.diagnostic(node, env);
                Ok(format!(
                    "{mark}{}.text({scope},{parent},{before},()=>[{deps}],()=>({value}){diagnostic});",
                    self.runtime
                ))
            }
        }
    }
    fn children(
        &mut self,
        children: &'a [JSXChild<'a>],
        env: &Env<'a>,
        scope: &str,
        parent: &str,
        before: &str,
    ) -> Result<String> {
        let mut out = String::new();
        for child in children {
            match child {
                JSXChild::Element(e) => out.push_str(&self.element(e, env, scope, parent, before)?),
                JSXChild::Fragment(f) => {
                    out.push_str(&self.children(&f.children, env, scope, parent, before)?)
                }
                JSXChild::Text(t) => {
                    let lines = t.value.replace('\r', "");
                    let lines = lines.split('\n').collect::<Vec<_>>();
                    let text = lines
                        .iter()
                        .enumerate()
                        .map(|(i, s)| {
                            let s = s.replace('\t', " ");
                            let s = if i > 0 { s.trim_start().to_owned() } else { s };
                            if i + 1 < lines.len() {
                                s.trim_end().to_owned()
                            } else {
                                s
                            }
                        })
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join(" ");
                    if !text.is_empty() {
                        out.push_str(&format!(
                            "{}{}.literal({parent},{before},{});",
                            self.marker(t.span),
                            self.runtime,
                            quote(&text)
                        ))
                    }
                }
                JSXChild::ExpressionContainer(c) => {
                    if let Some(e) = c.expression.as_expression() {
                        out.push_str(&self.render(e, env, scope, parent, before)?)
                    }
                }
                JSXChild::Spread(s) => {
                    return self.fail(
                        s.span,
                        "Spread children are unsupported. Render a domain collection with .map().",
                    );
                }
            }
        }
        Ok(out)
    }
    fn static_element(e: &JSXElement<'_>) -> bool {
        matches!(&e.opening_element.name,JSXElementName::Identifier(n) if n.name.chars().next().is_some_and(|c|c.is_ascii_lowercase()))
            && e.opening_element.attributes.iter().all(|a| {
                let JSXAttributeItem::Attribute(a) = a else {
                    return false;
                };
                let JSXAttributeName::Identifier(n) = &a.name else {
                    return false;
                };
                !["use", "ref", "key", "innerHTML"].contains(&n.name.as_str())
                    && !n.name.starts_with("on")
                    && match &a.value {
                        None | Some(JSXAttributeValue::StringLiteral(_)) => true,
                        Some(JSXAttributeValue::ExpressionContainer(c)) => {
                            c.expression.as_expression().is_none_or(Self::static_expr)
                        }
                        _ => false,
                    }
            })
            && e.children.iter().all(|c| match c {
                JSXChild::Text(_) => true,
                JSXChild::Element(e) => Self::static_element(e),
                JSXChild::ExpressionContainer(c) => {
                    c.expression.as_expression().is_none_or(Self::static_expr)
                }
                _ => false,
            })
    }
    fn static_expr(e: &Expression<'_>) -> bool {
        matches!(
            e,
            Expression::StringLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::BooleanLiteral(_)
                | Expression::NullLiteral(_)
        ) || matches!(e,Expression::JSXElement(e) if Self::static_element(e))
    }
    fn element(
        &mut self,
        e: &'a JSXElement<'a>,
        env: &Env<'a>,
        scope: &str,
        parent: &str,
        before: &str,
    ) -> Result<String> {
        let mark = self.marker(e.span);
        if !self.inside_static && Self::static_element(e) {
            let template = self.uid("template");
            let p = self.uid("parent");
            let b = self.uid("before");
            self.inside_static = true;
            let body = self.element(e, env, scope, &p, &b)?;
            self.inside_static = false;
            self.hoisted.push(format!(
                "{mark}const {template}={}.template(({p},{b})=>{{{body}}});",
                self.runtime
            ));
            return Ok(format!("{mark}{template}({parent},{before});"));
        }
        let tag = match &e.opening_element.name {
            JSXElementName::Identifier(n) => n.name.as_str(),
            JSXElementName::IdentifierReference(n) => n.name.as_str(),
            _ => {
                return self.fail(
                    e.span,
                    "Use a named compiled view, not a JSX namespace or member.",
                );
            }
        };
        if tag == "Portal" {
            let p = self.uid("parent");
            let b = self.uid("before");
            let body = self.children(&e.children, env, scope, &p, &b)?;
            return Ok(format!(
                "{mark}{}.portal({scope},({scope},{p},{b})=>{{{body}}});",
                self.runtime
            ));
        }
        let component = tag.chars().next().is_some_and(|c| c.is_ascii_uppercase());
        if component {
            if let JSXElementName::IdentifierReference(n) = &e.opening_element.name
                && self.index.symbol(n).is_some_and(|id| env.contains_key(&id))
            {
                return self.fail(
                    e.span,
                    "Dynamic view definitions need conditional JSX with named compiled views.",
                );
            }
            let has_children = e.children.iter().any(|c| !matches!(c,JSXChild::Text(t) if t.value.trim().is_empty()) && !matches!(c, JSXChild::ExpressionContainer(c) if c.expression.as_expression().is_none()));
            let attrs = self.attrs(e, true)?;
            if !has_children
                && attrs.len() == 2
                && attrs.iter().any(|(k, _)| k == "model")
                && attrs.iter().any(|(k, _)| k == "send")
            {
                let model = &attrs.iter().find(|(k, _)| k == "model").unwrap().1;
                let send = &attrs.iter().find(|(k, _)| k == "send").unwrap().1;
                let deps = model
                    .expr()
                    .map(|e| self.deps(e, env))
                    .unwrap_or_default()
                    .join(",");
                let value = model.rewrite(self, env);
                let send = send.rewrite(self, env);
                let message = self.uid("message");
                return Ok(format!(
                    "{mark}{}.child({scope},{parent},{before},{tag},()=>[{deps}],()=>({value}),({message})=>({send})({message}));",
                    self.runtime
                ));
            }
            if has_children && attrs.iter().any(|(name, _)| name == "children") {
                return self.fail(
                    e.span,
                    "Pass children once: use either JSX children or the children prop.",
                );
            }
            let mut out = mark;
            let mut reads = vec![];
            let mut props = vec![];
            if has_children {
                let content = self.uid("children");
                let slot_scope = self.uid("slot");
                let p = self.uid("parent");
                let b = self.uid("before");
                let body = self.children(&e.children, env, &slot_scope, &p, &b)?;
                out.push_str(&format!(
                    "const {content}={}.compiledSlot({scope},({slot_scope},{p},{b})=>{{{body}}});",
                    self.runtime
                ));
                props.push(format!("children:{content}"));
            }
            for (name, value) in attrs {
                if let Some(expr) = value.expr()
                    && (self.slot_function(expr)?.is_some() || self.is_template(expr, env, 0))
                {
                    let content = self.uid("content");
                    let build = self.slot_value(expr, env, scope)?;
                    out.push_str(&format!("const {content}={build};"));
                    props.push(format!("{}:{content}", quote(&name)));
                    continue;
                }
                let cached = self.uid("prop");
                let deps = value
                    .expr()
                    .map(|e| self.deps(e, env))
                    .unwrap_or_default()
                    .join(",");
                let read = match value.expr() {
                    Some(e) => self.snapshot(e, env),
                    None => value.rewrite(self, env),
                };
                let diag = value
                    .expr()
                    .map(|e| self.diagnostic(e, env))
                    .unwrap_or_default();
                out.push_str(&format!(
                    "const {cached}={scope}.derive(()=>[{deps}],()=>({read}){diag});"
                ));
                reads.push(format!("{cached}()"));
                props.push(format!("{}:{cached}()", quote(&name)));
            }
            out.push_str(&format!(
                "{}.child({scope},{parent},{before},{tag},()=>[{}],()=>({{{}}}),()=>{{}});",
                self.runtime,
                reads.join(","),
                props.join(",")
            ));
            return Ok(out);
        }
        let element = self.uid("element");
        let mut out = format!(
            "{mark}const {element}={}.element({parent},{before},{});",
            self.runtime,
            quote(tag)
        );
        for (name, value) in self.attrs(e, false)? {
            if ["key", "ref", "innerHTML"].contains(&name.as_str()) {
                return self.fail(e.span,&format!("{name} is not a snapshot-view attribute. Identity belongs to collections; DOM lifecycles belong to the host."));
            }
            let deps = value.expr().map(|e| self.deps(e, env)).unwrap_or_default();
            if name == "use" {
                let read = match value.expr() {
                    Some(e) => self.snapshot(e, env),
                    None => value.rewrite(self, env),
                };
                out.push_str(&format!(
                    "{}.attach({scope},{element},()=>[{}],()=>({read}));",
                    self.runtime,
                    deps.join(",")
                ));
            } else if name.starts_with("on")
                && name.chars().nth(2).is_some_and(|c| c.is_ascii_uppercase())
            {
                if matches!(value.expr(),Some(Expression::ArrowFunctionExpression(f)) if f.r#async)
                {
                    return self.fail(e.span,"Async work belongs in commands. Event handlers dispatch messages synchronously.");
                }
                let read = match value.expr() {
                    Some(e) => self.snapshot(e, env),
                    None => value.rewrite(self, env),
                };
                let event = self.uid("event");
                out.push_str(&format!(
                    "{}.event({scope},{element},{},({event})=>({read})({event}));",
                    self.runtime,
                    quote(&name)
                ));
            } else {
                let read = value.rewrite(self, env);
                let apply = format!(
                    "{}.attribute({element},{},({read}))",
                    self.runtime,
                    quote(&name)
                );
                if deps.is_empty() {
                    out.push_str(&format!("{apply};"))
                } else {
                    let diag = value
                        .expr()
                        .map(|e| self.diagnostic(e, env))
                        .unwrap_or_default();
                    out.push_str(&format!(
                        "{scope}.watch(()=>[{}],()=>{apply}{diag});",
                        deps.join(",")
                    ))
                }
            }
        }
        out.push_str(&self.children(&e.children, env, scope, &element, "null")?);
        Ok(out)
    }
    fn attrs(&self, e: &'a JSXElement<'a>, component: bool) -> Result<Vec<(String, Attr<'a>)>> {
        let mut out = vec![];
        for a in &e.opening_element.attributes {
            let JSXAttributeItem::Attribute(a) = a else {
                return self.fail(
                    e.span,
                    if component {
                        "Spread component inputs must be made explicit."
                    } else {
                        "Attribute spreads are unsupported; declare the attributes explicitly."
                    },
                );
            };
            let JSXAttributeName::Identifier(n) = &a.name else {
                return self.fail(
                    a.span,
                    "Attribute namespaces are unsupported; declare the attributes explicitly.",
                );
            };
            let value = match &a.value {
                None => Attr::Static("true".into()),
                Some(JSXAttributeValue::StringLiteral(s)) => Attr::Static(quote(s.value.as_str())),
                Some(JSXAttributeValue::ExpressionContainer(c)) => {
                    match c.expression.as_expression() {
                        Some(e) => Attr::Expr(e),
                        None => Attr::Static("true".into()),
                    }
                }
                _ => return self.fail(a.span, "Use an expression for attribute values."),
            };
            let name = n.name.to_string();
            if let Some(index) = out.iter().position(|(key, _)| key == &name) {
                out.remove(index);
            }
            out.push((name, value));
        }
        Ok(out)
    }
}
enum Attr<'a> {
    Expr(&'a Expression<'a>),
    Static(String),
}
impl<'a> Attr<'a> {
    fn expr(&self) -> Option<&'a Expression<'a>> {
        match self {
            Self::Expr(e) => Some(e),
            _ => None,
        }
    }
    fn rewrite(&self, c: &Lower<'a, '_>, env: &Env<'a>) -> String {
        match self {
            Self::Expr(e) => c.rewrite(e, env),
            Self::Static(s) => s.clone(),
        }
    }
}
