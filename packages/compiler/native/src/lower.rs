//! Lower snapshot JSX to calls into the existing DOM runtime.
//! Oxc bindings identify dependencies; ordinary source expressions retain their lexical syntax.
use crate::analysis::{Index, Reference, contains_jsx};
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
    #[serde(default)]
    pub diagnostics_only: bool,
}
#[derive(Serialize)]
pub struct Diagnostic {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub message: String,
    pub severity: String,
    pub code: String,
    pub category: String,
    pub remedy: String,
}
#[derive(Clone)]
enum Value<'a> {
    Read(String),
    Stable(String),
    Template(&'a Expression<'a>),
}
type Env<'a> = BTreeMap<SymbolId, Value<'a>>;
type Result<T> = std::result::Result<T, Box<Diagnostic>>;
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
    pub binding_markers: HashSet<SymbolId>,
    prefix: String,
    map_prefix: String,
    counter: usize,
    depth: usize,
}
impl<'a, 's> Lower<'a, 's> {
    pub fn new(
        source: &'a str,
        filename: &'a str,
        index: &'s Index<'a, 's>,
        options: &'s Options,
    ) -> Self {
        let mut prefix = "_ew_".to_string();
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
            binding_markers: HashSet::new(),
            prefix,
            map_prefix: crate::sourcemap::marker_prefix(source),
            counter: 0,
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
        Err(Box::new(Diagnostic {
            file: self.filename.into(),
            line,
            column: col,
            message: message.into(),
            severity: "error".into(),
            code: "EW1001".into(),
            category: "correctness".into(),
            remedy: message.into(),
        }))
    }

    fn unprovable<T>(&self, span: Span, message: &str) -> Result<T> {
        self.fail(span, message).map_err(|mut diagnostic| {
            diagnostic.code = "EW2001".into();
            diagnostic.category = "unprovable-dependency".into();
            diagnostic
        })
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
                Value::Read(v) | Value::Stable(v) => v.clone(),
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
    // Reads do not allocate a new prop value. They can share one dependency cache
    // for the child model; expressions constructing values keep independent caches.
    fn direct_read(e: &Expression<'_>) -> bool {
        match unwrapped(e) {
            Expression::Identifier(_) => true,
            Expression::StaticMemberExpression(m) => Self::direct_read(&m.object),
            Expression::ComputedMemberExpression(m) => {
                Self::direct_read(&m.object) && Self::static_expr(&m.expression)
            }
            _ => false,
        }
    }
    fn snapshot_body(&mut self, e: &Expression<'a>, env: &Env<'a>) -> (Env<'a>, String) {
        let mut local = env.clone();
        let mut captures = String::new();
        for id in self.captures(e, env) {
            let name = self.uid("capture");
            if let Some(Value::Read(value)) = env.get(&id) {
                captures.push_str(&format!("const {name}=({value});"));
            }
            local.insert(id, Value::Stable(name));
        }
        (local, captures)
    }
    fn snapshot_function(&mut self, e: &Expression<'a>, env: &Env<'a>) -> String {
        let (local, captures) = self.snapshot_body(e, env);
        format!("()=>{{{captures}return ({});}}", self.rewrite(e, &local))
    }
    fn event_handler(&mut self, e: &Expression<'a>, env: &Env<'a>) -> String {
        if let Expression::ArrowFunctionExpression(f) = unwrapped(e)
            && f.params.rest.is_none()
            && f.params.items.iter().all(|p| {
                p.initializer.is_none() && matches!(p.pattern, BindingPattern::BindingIdentifier(_))
            })
            && !matches!(&f.body, ArrowFunctionBody::FunctionBody(body) if !body.directives.is_empty())
        {
            let (local, captures) = self.snapshot_body(e, env);
            let params = f
                .params
                .items
                .iter()
                .map(|p| self.raw(p.span))
                .collect::<Vec<_>>()
                .join(",");
            let body = match &f.body {
                ArrowFunctionBody::FunctionBody(body) => body
                    .statements
                    .iter()
                    .map(|s| self.rewrite_span(s.span(), &local, 0))
                    .collect::<Vec<_>>()
                    .join("\n"),
                body => format!(
                    "return ({});",
                    self.rewrite(body.as_expression().unwrap(), &local)
                ),
            };
            return format!("({params})=>{{{captures}{body}}}");
        }
        let event = self.uid("event");
        let read = self.snapshot(e, env);
        format!("({event})=>({read})({event})")
    }
    fn deps(&self, e: &Expression<'a>, env: &Env<'a>) -> Vec<String> {
        self.dependencies(e, env, 0)
            .into_iter()
            .map(|(value, _)| value)
            .collect()
    }
    /// Expressions and labels share ordering and deduplication, including template captures.
    fn dependencies(
        &self,
        e: &Expression<'a>,
        env: &Env<'a>,
        depth: usize,
    ) -> Vec<(String, String)> {
        if depth > 100 {
            return vec![];
        }
        let mut found = vec![];
        let mut seen = HashSet::new();
        for r in self.index.references(e.span()) {
            let values = match r.symbol.and_then(|id| env.get(&id)) {
                Some(Value::Read(value)) => vec![(
                    if r.path.is_empty() {
                        value.clone()
                    } else {
                        format!("({value}){}", r.path.join(""))
                    },
                    r.label.clone(),
                )],
                Some(Value::Template(t)) => self.dependencies(t, env, depth + 1),
                Some(Value::Stable(_)) | None => vec![],
            };
            for (value, label) in values {
                if seen.insert(value.clone()) {
                    found.push((value, label));
                }
            }
        }
        found
    }
    fn diagnostic(&mut self, e: &Expression<'a>, env: &Env<'a>) -> String {
        if !self.options.development {
            return String::new();
        }
        let labels = self
            .dependencies(e, env, 0)
            .into_iter()
            .map(|(_, label)| label)
            .collect::<Vec<_>>();
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
            self.diagnostics.push(Diagnostic{file:self.filename.into(),line,column,severity:"warning".into(),code:"EW3001".into(),category:"performance".into(),remedy:"Pass only the model fields used by this helper.".into(),message:"This call depends on the whole model. Pass the fields it uses to avoid recomputing on unrelated changes.".into()});
        }
        format!(
            ",{}",
            serde_json::json!({"file":self.filename,"line":line,"column":column,"expression":self.raw(span),"dependencies":labels})
        )
    }
    fn simple_input(pattern: &BindingPattern<'a>) -> bool {
        match pattern {
            BindingPattern::BindingIdentifier(_) => true,
            BindingPattern::ObjectPattern(object) => {
                object.rest.is_none()
                    && object.properties.iter().all(|property| {
                        !property.computed
                            && matches!(
                                property.key,
                                PropertyKey::StaticIdentifier(_)
                                    | PropertyKey::StringLiteral(_)
                                    | PropertyKey::NumericLiteral(_)
                            )
                            && Self::simple_input(&property.value)
                    })
            }
            _ => false,
        }
    }
    fn bind_simple_input(pattern: &BindingPattern<'a>, read: String, env: &mut Env<'a>) {
        match pattern {
            BindingPattern::BindingIdentifier(id) => {
                env.insert(id.symbol_id.get().unwrap(), Value::Read(read));
            }
            BindingPattern::ObjectPattern(object) => {
                for property in &object.properties {
                    let key = match &property.key {
                        PropertyKey::StaticIdentifier(key) => quote(key.name.as_str()),
                        PropertyKey::StringLiteral(key) => quote(key.value.as_str()),
                        PropertyKey::NumericLiteral(key) => key.value.to_string(),
                        _ => unreachable!(),
                    };
                    Self::bind_simple_input(&property.value, format!("({read})[{key}]"), env);
                }
            }
            _ => unreachable!(),
        }
    }
    fn input_names(pattern: &BindingPattern<'a>, names: &mut Vec<(SymbolId, String)>) {
        match pattern {
            BindingPattern::BindingIdentifier(id) => {
                names.push((id.symbol_id.get().unwrap(), id.name.to_string()))
            }
            BindingPattern::AssignmentPattern(assignment) => {
                Self::input_names(&assignment.left, names)
            }
            BindingPattern::ObjectPattern(object) => {
                for property in &object.properties {
                    Self::input_names(&property.value, names);
                }
                if let Some(rest) = &object.rest {
                    Self::input_names(&rest.argument, names);
                }
            }
            BindingPattern::ArrayPattern(array) => {
                for element in array.elements.iter().flatten() {
                    Self::input_names(element, names);
                }
                if let Some(rest) = &array.rest {
                    Self::input_names(&rest.argument, names);
                }
            }
        }
    }
    /// Same-file render calls cannot hide mutable captures behind an ordinary helper.
    /// Imported code and factory-created objects remain explicit purity boundaries.
    fn external_capture(
        &self,
        reference: &Reference,
        safe_date: bool,
        invoked: bool,
        seen: &mut HashSet<(SymbolId, bool)>,
    ) -> Result<()> {
        if reference.in_action {
            return Ok(());
        }
        let Some(id) = reference.symbol else {
            if [
                "window",
                "document",
                "Date",
                "localStorage",
                "sessionStorage",
            ]
            .contains(&reference.name.as_str())
                && !(reference.name == "Date" && (reference.safe_date || safe_date))
            {
                return self.fail(
                    reference.span,
                    &format!(
                        "Read {} in a command or DOM host, then put its result in the model.",
                        reference.name
                    ),
                );
            }
            return Ok(());
        };
        let flags = self.index.scoping.symbol_flags(id);
        if (flags.is_variable()
            && !flags.is_const_variable()
            && !flags.is_function_scoped_declaration())
            || self.index.scoping.symbol_is_mutated(id)
        {
            return self.unprovable(reference.span, &format!("Mutable capture {} is not a model dependency. Pass immutable data through the model.", reference.name));
        }
        let called = invoked || self.index.render_called(reference);
        if !seen.insert((id, called)) {
            return Ok(());
        }
        if let Some(init) = self.index.initializers.get(&id)
            && matches!(
                unwrapped(init),
                Expression::Identifier(_)
                    | Expression::StaticMemberExpression(_)
                    | Expression::ComputedMemberExpression(_)
            )
        {
            for input in self.index.references(init.span()) {
                self.external_capture(input, safe_date || reference.safe_date, called, seen)?;
            }
        }
        // A reference to a callback is stable data. Inspect its body only when called
        // during rendering, so event handlers and command factories remain deferred.
        if called && let Some(body) = self.index.helpers.get(&id) {
            for (span, message) in &self.index.global_calls {
                if span.start >= body.start
                    && span.end <= body.end
                    && !self.index.deferred_host_body(*span, *body)
                {
                    return self.fail(*span, message);
                }
            }
            for input in self.index.references(*body) {
                if self.index.deferred_host_body(input.span, *body) {
                    continue;
                }
                let local = input.symbol.is_some_and(|id| {
                    let declaration = self.index.scoping.symbol_span(id);
                    declaration.start >= body.start && declaration.end <= body.end
                });
                if !local || self.index.acquisition_called(input) {
                    self.external_capture(input, false, false, seen)?;
                }
            }
        }
        Ok(())
    }

    pub fn compile_view(&mut self, call: &'a CallExpression<'a>) -> Result<String> {
        // Diagnostics continue after failed views, whose lowering may have exited early.
        self.depth = 0;
        let Some(Expression::ArrowFunctionExpression(f)) =
            call.arguments.first().and_then(|a| a.as_expression())
        else {
            return self.fail(call.span,"view((model, send) => JSX) requires a model parameter, an optional named dispatch parameter, and a synchronous pure body.");
        };
        if f.r#async
            || !(1..=2).contains(&f.params.items.len())
            || f.params.rest.is_some()
            || f.params.items.iter().any(|p| p.initializer.is_some())
            || f.params
                .items
                .get(1)
                .is_some_and(|p| !matches!(p.pattern, BindingPattern::BindingIdentifier(_)))
        {
            return self.fail(call.span,"view((model, send) => JSX) requires a model parameter, an optional named dispatch parameter, and a synchronous pure body.");
        }
        for (span, message) in &self.index.violations {
            if span.start >= f.span.start
                && span.end <= f.span.end
                && !(self.index.deferred_host_body(*span, f.span)
                    && self
                        .index
                        .global_calls
                        .iter()
                        .any(|(global, _)| global == span))
            {
                return self.fail(*span, message);
            }
        }
        let mut roots: HashSet<_> = self
            .index
            .binding_names(f.params.items[0].pattern.span())
            .into_iter()
            .map(|(id, _)| id)
            .collect();
        for (span, inputs) in &self.index.render_inputs {
            if span.start >= f.span.start && span.end <= f.span.end {
                roots.extend(inputs);
            }
        }
        for (receiver, span, method) in &self.index.callback_mutations {
            if span.start >= f.span.start
                && span.end <= f.span.end
                && self.index.borrows(receiver, &roots, &mut HashSet::new())
            {
                return self.fail(*span, &format!("Views cannot call mutating method {method} on model data. Dispatch a message and change the model in update."));
            }
        }
        for r in self.index.references(f.span) {
            if r.in_host || self.index.deferred_host_body(r.span, f.span) {
                continue;
            }
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
                    return self.unprovable(r.span,&format!("Mutable capture {} is not a model dependency. Pass immutable data through the model.",r.name));
                }
                self.external_capture(r, false, false, &mut HashSet::new())?;
            } else if [
                "window",
                "document",
                "Date",
                "localStorage",
                "sessionStorage",
            ]
            .contains(&r.name.as_str())
                && !r.in_event
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
        let input = &f.params.items[0].pattern;
        if let Some(dispatch) = f.params.items.get(1)
            && let BindingPattern::BindingIdentifier(id) = &dispatch.pattern
            && self
                .index
                .references(input.span())
                .any(|reference| reference.symbol == id.symbol_id.get())
        {
            return self.fail(input.span(), "Parameter defaults cannot capture dispatch. Declare that default inside the view body.");
        }

        let mut prelude = String::new();
        if Self::simple_input(input) {
            Self::bind_simple_input(input, format!("{scope}.value"), &mut env);
        } else {
            let mut names = vec![];
            Self::input_names(input, &mut names);
            let bindings = names
                .iter()
                .map(|(_, name)| name.clone())
                .collect::<Vec<_>>()
                .join(",");
            let cached = self.uid("input");
            let pattern = self.raw(input.span());
            prelude = format!(
                "const {cached}={scope}.derive(()=>[{scope}.value],()=>(({pattern})=>[{bindings}])({scope}.value));"
            );
            for (index, (id, _)) in names.into_iter().enumerate() {
                env.insert(id, Value::Read(format!("{cached}()[{index}]")));
            }
        }
        if let Some(p) = f.params.items.get(1)
            && let BindingPattern::BindingIdentifier(id) = &p.pattern
        {
            env.insert(
                id.symbol_id.get().unwrap(),
                Value::Stable(format!("{scope}.send")),
            );
        }
        let body = format!(
            "{prelude}{}",
            self.function_body(&f.body, &env, &scope, &parent, &before)?
        );
        Ok(format!(
            "{}/* @__PURE__ */ {}.compiled(({scope},{parent},{before})=>{{{body}}})",
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
                            let compute = self.snapshot_function(init, &env);
                            let diagnostic = self.diagnostic(init, &env);
                            if deps.is_empty() && matches!(decl.id, BindingPattern::BindingIdentifier(_))
                                && (Self::static_expr(init) || matches!(unwrapped(init), Expression::ArrowFunctionExpression(_))) {
                                output.push_str(&format!("const {cached}=({value});"));
                                let BindingPattern::BindingIdentifier(id) = &decl.id else { unreachable!() };
                                env.insert(id.symbol_id.get().unwrap(), Value::Stable(cached));
                                continue;
                            }
                            output.push_str(&format!("const {cached}={scope}.derive(()=>[{deps}],{compute}{diagnostic});"));
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
                if self.index.raw_object_array(&m.object) {
                    let mut diagnostic = self.fail::<()>(m.object.span(), "Raw object arrays need explicit collection identity. Use entities(items) for domain IDs, collection(item => item.domainKey).from(items) for custom identity, or sequence(items) for positional identity.").unwrap_err();
                    diagnostic.code = "EW1002".into();
                    return Err(diagnostic);
                }
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
                    let text = Self::jsx_text(t.value.as_str());
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
    fn template_element(e: &JSXElement<'_>) -> bool {
        matches!(&e.opening_element.name, JSXElementName::Identifier(n)
            if n.name.chars().next().is_some_and(|c| c.is_ascii_lowercase())
                && !["input", "textarea", "select", "option"].contains(&n.name.as_str())
                && !n.name.contains('-'))
            && e.opening_element.attributes.iter().all(|a| matches!(a, JSXAttributeItem::Attribute(a)
                if matches!(&a.name, JSXAttributeName::Identifier(n) if !["ref", "key", "innerHTML"].contains(&n.name.as_str()))))
    }
    fn template_size(e: &JSXElement<'_>) -> usize {
        if !Self::template_element(e) {
            return 0;
        }
        1 + e
            .children
            .iter()
            .map(|c| match c {
                JSXChild::Element(e) => Self::template_size(e),
                _ => 0,
            })
            .sum::<usize>()
    }
    // Serialize only compile-time literals. Calls, getters, hosts, and closures run at
    // their original placement. All node references are resolved before any binding
    // can insert content, so dynamic siblings cannot shift a later lookup.
    fn template_shape(
        &mut self,
        e: &'a JSXElement<'a>,
        env: &Env<'a>,
        scope: &str,
        path: &str,
    ) -> Result<(String, String, String)> {
        let JSXElementName::Identifier(tag) = &e.opening_element.name else {
            unreachable!()
        };
        let element = self.uid("element");
        let mut shape = vec![quote(tag.name.as_str())];
        let mut fixed = vec![];
        let mut dynamic = vec![];
        // Preserve attribute ordering when more than one attribute can contribute
        // to the same DOM state, such as class and classList.
        let attrs = self.attrs(e, false)?;
        let mut dynamic_attributes = HashSet::new();
        for (name, value) in attrs {
            let key = match name.as_str() {
                "class" | "className" | "classList" => "class",
                "tabIndex" => "tabindex",
                "htmlFor" => "for",
                name => name,
            };
            let literal = !dynamic_attributes.contains(key)
                && name != "use"
                && !name.starts_with("on")
                && value.expr().is_none_or(|expr| match expr {
                    Expression::StringLiteral(_)
                    | Expression::BooleanLiteral(_)
                    | Expression::NullLiteral(_) => true,
                    Expression::NumericLiteral(n) => n.value.is_finite(),
                    _ => false,
                });
            if literal {
                fixed.push(quote(&name));
                let literal = match value {
                    Attr::Static(value) => value,
                    Attr::Expr(Expression::StringLiteral(value)) => quote(value.value.as_str()),
                    Attr::Expr(Expression::NumericLiteral(value)) => value.value.to_string(),
                    Attr::Expr(Expression::BooleanLiteral(value)) => value.value.to_string(),
                    Attr::Expr(Expression::NullLiteral(_)) => "null".into(),
                    value => value.rewrite(self, env),
                };
                fixed.push(literal);
            } else {
                dynamic_attributes.insert(key.to_owned());
                dynamic.push((name, value));
            }
        }
        shape.push(format!("[{}]", fixed.join(",")));
        let mut refs = format!("const {element}={path};");
        let mut bind = self.element_attributes(e, env, scope, &element, dynamic)?;
        let mut index = 0;
        let mut text_before = false;
        let mut anchors = BTreeMap::<usize, String>::new();
        for (child_index, child) in e.children.iter().enumerate() {
            match child {
                JSXChild::Element(child) if Self::template_element(child) => {
                    let (child_shape, child_refs, child_bind) = self.template_shape(
                        child,
                        env,
                        scope,
                        &anchors.get(&index).cloned().unwrap_or_else(|| {
                            if index == 0 {
                                format!("{element}.firstChild")
                            } else {
                                format!("{element}.childNodes[{index}]")
                            }
                        }),
                    )?;
                    text_before = false;
                    shape.push(child_shape);
                    refs.push_str(&child_refs);
                    bind.push_str(&child_bind);
                    index += 1;
                }
                JSXChild::Text(text) => {
                    let text = Self::jsx_text(text.value.as_str());
                    if !text.is_empty() {
                        // Parsing joins adjacent text, so retain one boundary only
                        // when two static text nodes must stay independently addressable.
                        if text_before {
                            shape.push("null".into());
                            index += 1;
                        }
                        text_before = true;
                        shape.push(quote(&text));
                        index += 1;
                    }
                }
                JSXChild::ExpressionContainer(c) if c.expression.as_expression().is_none() => {}
                child => {
                    // All dynamic regions have their own lifetime boundaries. Reuse
                    // the following static sibling, or append, instead of adding a
                    // second marker for every branch, component, and list.
                    let following = e.children[child_index + 1..]
                        .iter()
                        .any(|child| match child {
                            JSXChild::Element(child) => Self::template_element(child),
                            JSXChild::Text(text) => !Self::jsx_text(text.value.as_str()).is_empty(),
                            _ => false,
                        });
                    let anchor = if following {
                        if let Some(anchor) = anchors.get(&index) {
                            anchor.clone()
                        } else {
                            let anchor = self.uid("anchor");
                            refs.push_str(&format!(
                                "const {anchor}={element}.childNodes[{index}];"
                            ));
                            anchors.insert(index, anchor.clone());
                            anchor
                        }
                    } else {
                        "null".into()
                    };
                    bind.push_str(&self.children(
                        std::slice::from_ref(child),
                        env,
                        scope,
                        &element,
                        &anchor,
                    )?);
                }
            }
        }
        if bind.is_empty() {
            refs.clear();
        }
        Ok((format!("[{}]", shape.join(",")), refs, bind))
    }
    fn template_native(&mut self, node: &serde_json::Value, parent: &str, before: &str) -> String {
        if node.is_null() {
            return format!(
                "{parent}.insertBefore(({parent}.ownerDocument??document).createComment(''),{before});"
            );
        }
        if let Some(text) = node.as_str() {
            return format!(
                "{}.literal({parent},{before},{});",
                self.runtime,
                quote(text)
            );
        }
        let node = node.as_array().unwrap();
        let element = self.uid("element");
        let mut build = format!(
            "const {element}={}.element({parent},{before},{});",
            self.runtime, node[0]
        );
        for attribute in node[1].as_array().unwrap().as_chunks::<2>().0 {
            build.push_str(&format!(
                "{}.attribute({element},{},{});",
                self.runtime, attribute[0], attribute[1]
            ));
        }
        for child in &node[2..] {
            build.push_str(&self.template_native(child, &element, "null"));
        }
        build
    }
    fn jsx_text(value: &str) -> String {
        let lines = value.replace('\r', "");
        let lines = lines.split('\n').collect::<Vec<_>>();
        lines
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
            .join(" ")
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
        if Self::template_size(e) > 1 || (Self::template_element(e) && Self::static_element(e)) {
            let template = self.uid("template");
            let root = self.uid("root");
            let (shape, refs, bind) = self.template_shape(e, env, scope, &root)?;
            let factory = match crate::template::serialize(&shape) {
                Some((html, depth)) => {
                    format!("{}.template({},{depth})", self.runtime, quote(&html))
                }
                None => {
                    let p = self.uid("parent");
                    let b = self.uid("before");
                    let node = serde_json::from_str(&shape)
                        .expect("Compiler template literals must be JSON");
                    let build = self.template_native(&node, &p, &b);
                    format!("{}.template(({p},{b})=>{{{build}}})", self.runtime)
                }
            };
            self.hoisted
                .push(format!("{mark}const {template}=/* @__PURE__ */ {factory};"));
            return Ok(format!(
                "{mark}const {root}={template}({parent},{before});{refs}{bind}"
            ));
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
            let binding = matches!(&e.opening_element.name, JSXElementName::IdentifierReference(n)
                if self.index.symbol(n).is_some_and(|id| self.binding_markers.contains(&id)));
            if binding {
                if has_children
                    || attrs.len() != 3
                    || !["view", "model", "send"]
                        .iter()
                        .all(|name| attrs.iter().any(|(k, _)| k == name))
                {
                    return self.fail(
                        e.span,
                        "ViewBinding requires explicit view, model and send props and no children.",
                    );
                }
                let target = &attrs.iter().find(|(k, _)| k == "view").unwrap().1;
                let Some(Expression::Identifier(target_id)) = target.expr().map(unwrapped) else {
                    return self.fail(e.span, "ViewBinding view must be a named compiled view. Use conditional JSX to choose views.");
                };
                if self
                    .index
                    .symbol(target_id)
                    .is_some_and(|id| env.contains_key(&id))
                {
                    return self.fail(e.span, "ViewBinding view must be a named compiled view. Use conditional JSX to choose views.");
                }
                let tag = target.rewrite(self, env);
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
            let mut grouped = false;
            let mut children_prop = None;
            let mut group_env = env.clone();
            let mut group_ids = HashSet::new();
            let mut group_captures = String::new();
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
                children_prop = Some(format!("children:{content}"));
            }
            for (name, value) in attrs {
                let spread = matches!(value, Attr::Spread(_));
                if !spread
                    && let Some(expr) = value.expr()
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
                if deps.is_empty() {
                    out.push_str(&format!("const {cached}=({read});"));
                    props.push(if spread {
                        format!("...({cached})")
                    } else {
                        format!("{}:{cached}", quote(&name))
                    });
                    continue;
                }
                if !spread
                    && !self.options.development
                    && value.expr().is_some_and(Self::direct_read)
                {
                    reads.extend(value.expr().map(|e| self.deps(e, env)).unwrap_or_default());
                    let expr = value.expr().unwrap();
                    for id in self.captures(expr, env) {
                        if group_ids.insert(id) {
                            let capture = self.uid("capture");
                            if let Some(Value::Read(value)) = env.get(&id) {
                                group_captures.push_str(&format!("const {capture}=({value});"));
                            }
                            group_env.insert(id, Value::Stable(capture));
                        }
                    }
                    props.push(format!(
                        "{}:({})",
                        quote(&name),
                        self.rewrite(expr, &group_env)
                    ));
                    grouped = true;
                    continue;
                }
                let diag = value
                    .expr()
                    .map(|e| self.diagnostic(e, env))
                    .unwrap_or_default();
                let compute = value
                    .expr()
                    .map(|e| self.snapshot_function(e, env))
                    .unwrap_or_else(|| format!("()=>({read})"));
                out.push_str(&format!(
                    "const {cached}={scope}.derive(()=>[{deps}],{compute}{diag});"
                ));
                reads.push(format!("{cached}()"));
                props.push(if spread {
                    format!("...({cached}())")
                } else {
                    format!("{}:{cached}()", quote(&name))
                });
            }
            if let Some(children) = children_prop {
                props.push(children);
            }
            if grouped {
                let model = self.uid("props");
                let mut seen = HashSet::new();
                reads.retain(|read| seen.insert(read.clone()));
                let compute = format!("()=>{{{group_captures}return ({{{}}});}}", props.join(","));
                out.push_str(&format!("const {model}={scope}.derive(()=>[{}],{compute});{}.child({scope},{parent},{before},{tag},()=>[{model}()],{model},()=>{{}});", reads.join(","), self.runtime));
            } else {
                out.push_str(&format!(
                    "{}.child({scope},{parent},{before},{tag},()=>[{}],()=>({{{}}}),()=>{{}});",
                    self.runtime,
                    reads.join(","),
                    props.join(",")
                ));
            }
            return Ok(out);
        }
        let element = self.uid("element");
        let mut out = format!(
            "{mark}const {element}={}.element({parent},{before},{});",
            self.runtime,
            quote(tag)
        );
        out.push_str(&self.element_attributes(e, env, scope, &element, self.attrs(e, false)?)?);
        out.push_str(&self.children(&e.children, env, scope, &element, "null")?);
        Ok(out)
    }
    fn element_attributes(
        &mut self,
        e: &'a JSXElement<'a>,
        env: &Env<'a>,
        scope: &str,
        element: &str,
        attrs: Vec<(String, Attr<'a>)>,
    ) -> Result<String> {
        let mut out = String::new();
        if attrs
            .iter()
            .any(|(_, value)| matches!(value, Attr::Spread(_)))
        {
            let mut deps = vec![];
            let mut props = vec![];
            for (name, value) in attrs {
                if ["key", "ref", "innerHTML"].contains(&name.as_str()) {
                    return self.fail(e.span, "Use collections for identity and DOM hosts for lifecycles; key, ref and innerHTML are unsupported.");
                }
                if let Some(expr) = value.expr() {
                    deps.extend(self.deps(expr, env));
                }
                let read = if name.starts_with("on")
                    && name.chars().nth(2).is_some_and(|c| c.is_ascii_uppercase())
                {
                    if matches!(value.expr(),Some(Expression::ArrowFunctionExpression(f)) if f.r#async)
                    {
                        return self.fail(e.span, "Async work belongs in commands. Event handlers dispatch messages synchronously.");
                    }
                    value
                        .expr()
                        .map(|expr| self.event_handler(expr, env))
                        .unwrap_or_else(|| value.rewrite(self, env))
                } else {
                    value
                        .expr()
                        .map(|expr| self.snapshot(expr, env))
                        .unwrap_or_else(|| value.rewrite(self, env))
                };
                props.push(if matches!(value, Attr::Spread(_)) {
                    format!("...({read})")
                } else {
                    format!("{}:({read})", quote(&name))
                });
            }
            let mut seen = HashSet::new();
            deps.retain(|dep| seen.insert(dep.clone()));
            return Ok(format!(
                "{}.bindAttributes({scope},{element},()=>[{}],()=>({{{}}}));",
                self.runtime,
                deps.join(","),
                props.join(",")
            ));
        }
        for (name, value) in attrs {
            if ["key", "ref", "innerHTML"].contains(&name.as_str()) {
                return self.fail(e.span,&format!("{name} is not an EffectWeb view attribute. Identity belongs to collections; DOM lifecycles belong to the host."));
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
                let handler = match value.expr() {
                    Some(expr) => self.event_handler(expr, env),
                    None => {
                        let event = self.uid("event");
                        format!("({event})=>({})({event})", value.rewrite(self, env))
                    }
                };
                out.push_str(&format!(
                    "{}.event({scope},{element},{},{handler});",
                    self.runtime,
                    quote(&name)
                ));
            } else {
                let read = value.rewrite(self, env);
                let control = matches!(&e.opening_element.name, JSXElementName::Identifier(tag)
                    if (name == "value" && ["input", "textarea", "select"].contains(&tag.name.as_str()))
                        || (name == "checked" && tag.name == "input"));
                if control {
                    let diag = value
                        .expr()
                        .map(|e| self.diagnostic(e, env))
                        .unwrap_or_default();
                    out.push_str(&format!(
                        "{}.bindControl({scope},{element},{},()=>[{}],()=>({read}){diag});",
                        self.runtime,
                        quote(&name),
                        deps.join(",")
                    ));
                    continue;
                }
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
                    if name == "class" || name == "className" {
                        out.push_str(&format!(
                            "{}.bindAttribute({scope},{element},{},()=>[{}],()=>({read}){diag});",
                            self.runtime,
                            quote(&name),
                            deps.join(",")
                        ))
                    } else {
                        out.push_str(&format!(
                            "{scope}.watch(()=>[{}],()=>{apply}{diag});",
                            deps.join(",")
                        ))
                    }
                }
            }
        }
        Ok(out)
    }
    fn attrs(&self, e: &'a JSXElement<'a>, _component: bool) -> Result<Vec<(String, Attr<'a>)>> {
        let mut out = vec![];
        for a in &e.opening_element.attributes {
            let a = match a {
                JSXAttributeItem::Attribute(a) => a,
                JSXAttributeItem::SpreadAttribute(a) => {
                    out.push((String::new(), Attr::Spread(&a.argument)));
                    continue;
                }
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
    Spread(&'a Expression<'a>),
    Static(String),
}
impl<'a> Attr<'a> {
    fn expr(&self) -> Option<&'a Expression<'a>> {
        match self {
            Self::Expr(e) | Self::Spread(e) => Some(e),
            _ => None,
        }
    }
    fn rewrite(&self, c: &Lower<'a, '_>, env: &Env<'a>) -> String {
        match self {
            Self::Expr(e) | Self::Spread(e) => c.rewrite(e, env),
            Self::Static(s) => s.clone(),
        }
    }
}
