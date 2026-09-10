//! Certify the semantics of render work before lowering it.
//!
//! Source indexing has no authority to declare a call pure or a buffer owned.
//! This analysis follows values across call edges with explicit argument bindings
//! and an execution phase. Unresolved call targets never constitute a proof.
use crate::{analysis::Index, lower::Options};
use oxc::{
    ast::ast::*,
    ast_visit::{Visit, walk},
    span::{GetSpan, Span},
    syntax::symbol::SymbolId,
};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    rc::Rc,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Phase {
    Render,
    Event,
    Host,
    Initializer,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ownership {
    Borrowed,
    Shallow,
    Deep,
}
#[derive(Clone, Copy)]
enum Callable<'a> {
    Arrow(&'a ArrowFunctionExpression<'a>),
    Function(&'a Function<'a>),
}
impl<'a> Callable<'a> {
    fn span(self) -> Span {
        match self {
            Self::Arrow(f) => f.span,
            Self::Function(f) => f.span,
        }
    }
    fn params(self) -> &'a FormalParameters<'a> {
        match self {
            Self::Arrow(f) => &f.params,
            Self::Function(f) => &f.params,
        }
    }
    fn asynchronous(self) -> bool {
        match self {
            Self::Arrow(f) => f.r#async,
            Self::Function(f) => f.r#async,
        }
    }
}
type Bindings<'a> = BTreeMap<SymbolId, Value<'a>>;
#[derive(Clone)]
struct FunctionValue<'a> {
    callable: Callable<'a>,
    bindings: Rc<Bindings<'a>>,
    receiver: Option<Box<Value<'a>>>,
}
#[derive(Clone)]
enum Kind<'a> {
    Unknown(String),
    Opaque,
    Scalar(Option<String>),
    Data,
    Native,
    Object(&'a ObjectExpression<'a>, Rc<Bindings<'a>>),
    Array(&'a ArrayExpression<'a>, Rc<Bindings<'a>>),
    Function(FunctionValue<'a>),
    Global(String, Vec<String>),
    Import(String, Vec<String>),
    Member(Box<Value<'a>>, String),
    Union(Vec<Value<'a>>),
    Api(String, Vec<String>, Vec<Value<'a>>),
    Compiled,
    RawJsx,
}
#[derive(Clone)]
struct Value<'a> {
    kind: Kind<'a>,
    ownership: Ownership,
    reads: BTreeSet<SymbolId>,
    // Ambient objects are stable only while their reachable properties cannot change.
    ambient: BTreeSet<SymbolId>,
    source: Option<(Span, Vec<Option<String>>)>,
}
impl<'a> Value<'a> {
    fn new(kind: Kind<'a>) -> Self {
        Self {
            kind,
            ownership: Ownership::Borrowed,
            reads: BTreeSet::new(),
            ambient: BTreeSet::new(),
            source: None,
        }
    }
    fn unknown(reason: impl Into<String>) -> Self {
        Self::new(Kind::Unknown(reason.into()))
    }
    fn scalar() -> Self {
        Self::new(Kind::Scalar(None))
    }
    fn data() -> Self {
        Self::new(Kind::Data)
    }
    fn owned(deep: bool) -> Self {
        let mut value = Self::new(Kind::Native);
        value.ownership = if deep {
            Ownership::Deep
        } else {
            Ownership::Shallow
        };
        value
    }
    fn with_reads(mut self, input: &Self) -> Self {
        self.reads.extend(&input.reads);
        self
    }
    fn callable(&self) -> bool {
        matches!(
            self.kind,
            Kind::Function(_) | Kind::Import(..) | Kind::Global(..) | Kind::Api(..)
        )
    }
}
#[derive(Clone)]
pub struct Issue {
    pub span: Span,
    pub message: String,
    pub unprovable: bool,
}
impl Issue {
    fn invalid(span: Span, message: impl Into<String>) -> Self {
        Self {
            span,
            message: message.into(),
            unprovable: false,
        }
    }
    fn unknown(span: Span, message: impl Into<String>) -> Self {
        Self {
            span,
            message: format!("Cannot prove {}", message.into()),
            unprovable: true,
        }
    }
}
/// A certificate is created only after all reachable work is checked. Lowering
/// may retain precise syntactic paths; these roots complete hidden helper reads.
#[derive(Default)]
pub struct Certificate {
    pub reads: HashMap<Span, BTreeSet<SymbolId>>,
    pub bindings: HashMap<SymbolId, BTreeSet<SymbolId>>,
    pub guards: BTreeMap<Span, Vec<IntrinsicGuard>>,
}
type IntrinsicGuard = (Vec<Option<String>>, String);
pub fn certify<'a>(
    index: &Index<'a, '_>,
    function: &'a ArrowFunctionExpression<'a>,
    options: &Options,
) -> Result<Certificate, Issue> {
    let mut analyzer = Analyzer {
        index,
        options,
        phase: Phase::Render,
        bindings: Rc::new(BTreeMap::new()),
        receiver: None,
        scopes: vec![function.span],
        resolving: HashSet::new(),
        checking: HashSet::new(),
        certificate: Certificate::default(),
        error: None,
        root: function.span,
        steps: 0,
        slot_position: true,
        auditing_ambient: false,
        ambient_proofs: HashMap::new(),
        audit_root: None,
        ambient_mutated: false,
    };
    let mut bindings = BTreeMap::new();
    for (position, parameter) in function.params.items.iter().enumerate() {
        let mut value = Value::data();
        if position == 0 {
            value.reads.extend(
                index
                    .binding_names(parameter.pattern.span())
                    .into_iter()
                    .map(|(id, _)| id),
            );
        } else {
            value.kind = Kind::Global("<dispatch>".into(), vec![]);
        }
        analyzer.bind(&parameter.pattern, value, &mut bindings, 0);
    }
    analyzer.bindings = Rc::new(bindings);
    analyzer.visit_arrow_function_body(&function.body);
    match analyzer.error {
        Some(error) => Err(error),
        None => Ok(analyzer.certificate),
    }
}
struct Analyzer<'a, 's> {
    index: &'s Index<'a, 's>,
    options: &'s Options,
    phase: Phase,
    bindings: Rc<Bindings<'a>>,
    receiver: Option<Value<'a>>,
    scopes: Vec<Span>,
    resolving: HashSet<SymbolId>,
    checking: HashSet<(Span, Phase)>,
    certificate: Certificate,
    error: Option<Issue>,
    root: Span,
    steps: usize,
    slot_position: bool,
    auditing_ambient: bool,
    ambient_proofs: HashMap<SymbolId, bool>,
    audit_root: Option<SymbolId>,
    ambient_mutated: bool,
}
fn unwrap<'a>(mut e: &'a Expression<'a>) -> &'a Expression<'a> {
    loop {
        e = match e {
            Expression::ParenthesizedExpression(n) => &n.expression,
            Expression::TSAsExpression(n) => &n.expression,
            Expression::TSSatisfiesExpression(n) => &n.expression,
            Expression::TSNonNullExpression(n) => &n.expression,
            _ => return e,
        };
    }
}
impl<'a> Analyzer<'a, '_> {
    fn fail(&mut self, issue: Issue) {
        if self.auditing_ambient {
            return;
        }
        if self.error.is_none() {
            self.error = Some(issue);
        }
    }
    fn local(&self, id: SymbolId) -> bool {
        self.scopes
            .iter()
            .any(|scope| scope.contains_inclusive(self.index.scoping.symbol_span(id)))
    }
    fn observe(&mut self, span: Span, value: &Value<'a>) {
        self.certificate
            .reads
            .entry(span)
            .or_default()
            .extend(&value.reads);
    }
    fn symbol(&mut self, id: SymbolId, bindings: &Rc<Bindings<'a>>, depth: usize) -> Value<'a> {
        if let Some(value) = bindings.get(&id) {
            return value.clone();
        }
        if depth > 80 || !self.resolving.insert(id) {
            return Value::unknown("a recursive value's provenance");
        }
        let flags = self.index.scoping.symbol_flags(id);
        let mut value = if self.index.scoping.symbol_is_mutated(id)
            || (flags.is_variable()
                && !flags.is_const_variable()
                && !flags.is_function_scoped_declaration())
        {
            // Mutation of a scalar local is legal. Its original initializer cannot
            // prove that its later value is an owned object or a callable.
            Value::unknown(format!(
                "Mutable capture {} is not a model dependency. Pass immutable data through the model.",
                self.index.scoping.symbol_name(id)
            ))
        } else if let Some((module, path)) = self.index.imports.get(&id) {
            Value::new(Kind::Import(module.clone(), path.clone()))
        } else if let Some(function) = self.index.functions.get(&id) {
            Value::new(Kind::Function(FunctionValue {
                callable: Callable::Function(function),
                bindings: bindings.clone(),
                receiver: None,
            }))
        } else if let Some(declaration) = self.index.declarators.get(&id) {
            let declaration = *declaration;
            let local = self.local(id);
            let previous_phase = self.phase;
            if !local {
                self.phase = Phase::Initializer;
            }
            let input = declaration
                .init
                .as_ref()
                .map(|e| self.resolve(e, bindings, depth + 1))
                .unwrap_or_else(Value::data);
            let mut values = BTreeMap::new();
            self.bind(&declaration.id, input, &mut values, depth + 1);
            self.phase = previous_phase;
            let mut result = values
                .remove(&id)
                .unwrap_or_else(|| Value::unknown("this destructured value's provenance"));
            if !local
                && matches!(result.kind, Kind::Unknown(_))
                && declaration.init.as_ref().is_some_and(|e| {
                    matches!(
                        unwrap(e),
                        Expression::CallExpression(_) | Expression::NewExpression(_)
                    )
                })
            {
                result.kind = Kind::Opaque;
            }
            if !local
                || self
                    .scopes
                    .iter()
                    .skip(1)
                    .all(|scope| !scope.contains_inclusive(self.index.scoping.symbol_span(id)))
            {
                result.ownership = Ownership::Borrowed;
                if !local
                    && matches!(
                        result.kind,
                        Kind::Object(..)
                            | Kind::Array(..)
                            | Kind::Data
                            | Kind::Native
                            | Kind::Unknown(_)
                    )
                {
                    result.ambient.insert(id);
                }
            }
            result
        } else {
            Value::unknown(format!(
                "the provenance of {}",
                self.index.scoping.symbol_name(id)
            ))
        };
        if self.index.scoping.symbol_is_mutated(id) && self.local(id) {
            value.ambient.clear();
        }
        self.certificate
            .bindings
            .entry(id)
            .or_default()
            .extend(&value.reads);
        if !self.local(id)
            && !matches!(
                value.kind,
                Kind::Function(_) | Kind::Object(..) | Kind::Array(..) | Kind::Native
            )
        {
            value.source = None;
        }
        self.resolving.remove(&id);
        value
    }
    fn bind(
        &mut self,
        pattern: &'a BindingPattern<'a>,
        input: Value<'a>,
        output: &mut Bindings<'a>,
        depth: usize,
    ) {
        if depth > 80 {
            return;
        }
        match pattern {
            BindingPattern::BindingIdentifier(id) => {
                output.insert(id.symbol_id.get().unwrap(), input);
            }
            BindingPattern::AssignmentPattern(n) => {
                let previous = self.bindings.clone();
                self.bindings = Rc::new(output.clone());
                self.visit_expression(&n.right);
                self.bindings = previous;
                let default = self.resolve(&n.right, &Rc::new(output.clone()), depth + 1);
                self.bind(&n.left, self.join(vec![input, default]), output, depth + 1);
            }
            BindingPattern::ObjectPattern(n) => {
                for property in &n.properties {
                    if property.computed
                        && let Some(expression) = property.key.as_expression()
                    {
                        let previous = self.bindings.clone();
                        self.bindings = Rc::new(output.clone());
                        self.visit_expression(expression);
                        self.bindings = previous;
                    }
                    let name = self.key(
                        &property.key,
                        property.computed,
                        &Rc::new(output.clone()),
                        depth + 1,
                    );
                    let value = name
                        .map(|name| self.member(input.clone(), &name, depth + 1))
                        .unwrap_or_else(|| Value::unknown("a dynamic property"));
                    self.bind(&property.value, value, output, depth + 1);
                }
                if let Some(rest) = &n.rest {
                    // Exclusions cannot introduce effects; retaining the original
                    // field provenance is conservative for every retained member.
                    let mut rest_value = input.clone();
                    rest_value.ownership = Ownership::Shallow;
                    self.bind(&rest.argument, rest_value, output, depth + 1);
                }
            }
            BindingPattern::ArrayPattern(n) => {
                for (position, element) in n.elements.iter().enumerate() {
                    if let Some(element) = element {
                        let value = self.member(input.clone(), &position.to_string(), depth + 1);
                        self.bind(element, value, output, depth + 1);
                    }
                }
                if let Some(rest) = &n.rest {
                    self.bind(
                        &rest.argument,
                        Value::owned(false).with_reads(&input),
                        output,
                        depth + 1,
                    );
                }
            }
        }
    }
    fn key(
        &mut self,
        key: &'a PropertyKey<'a>,
        computed: bool,
        bindings: &Rc<Bindings<'a>>,
        depth: usize,
    ) -> Option<String> {
        if !computed {
            return key.static_name().map(|name| name.to_string());
        }
        key.as_expression()
            .and_then(|e| match self.resolve(e, bindings, depth + 1).kind {
                Kind::Scalar(value) => value,
                _ => None,
            })
    }
    fn join(&self, mut values: Vec<Value<'a>>) -> Value<'a> {
        if values.len() == 1 {
            return values.pop().unwrap();
        }
        let mut result = Value::new(Kind::Union(vec![]));
        result.ownership = if values.iter().all(|v| v.ownership == Ownership::Deep) {
            Ownership::Deep
        } else if values.iter().all(|v| v.ownership != Ownership::Borrowed) {
            Ownership::Shallow
        } else {
            Ownership::Borrowed
        };
        for value in &values {
            result.reads.extend(&value.reads);
            result.ambient.extend(&value.ambient);
        }
        result.kind = Kind::Union(values);
        result
    }
    fn resolve(
        &mut self,
        e: &'a Expression<'a>,
        bindings: &Rc<Bindings<'a>>,
        depth: usize,
    ) -> Value<'a> {
        if depth > 80 {
            return Value::unknown("a value beyond the analysis depth limit");
        }
        let mut value = match unwrap(e) {
            Expression::Identifier(id)
                if self.index.symbol(id).is_none()
                    && ["undefined", "NaN", "Infinity"].contains(&id.name.as_str()) =>
            {
                Value::scalar()
            }
            Expression::Identifier(id) => self
                .index
                .symbol(id)
                .map(|id| self.symbol(id, bindings, depth + 1))
                .unwrap_or_else(|| Value::new(Kind::Global(id.name.to_string(), vec![]))),
            Expression::ThisExpression(_) => self
                .receiver
                .clone()
                .unwrap_or_else(|| Value::unknown("an unbound this receiver")),
            Expression::StringLiteral(n) => Value::new(Kind::Scalar(Some(n.value.to_string()))),
            Expression::NumericLiteral(n) => Value::new(Kind::Scalar(Some(n.value.to_string()))),
            Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_) => Value::scalar(),
            Expression::TemplateLiteral(n) if n.expressions.is_empty() => Value::new(Kind::Scalar(
                n.quasis.first().map(|q| q.value.raw.to_string()),
            )),
            Expression::ArrowFunctionExpression(f) => Value::new(Kind::Function(FunctionValue {
                callable: Callable::Arrow(f),
                bindings: bindings.clone(),
                receiver: self.receiver.clone().map(Box::new),
            })),
            Expression::FunctionExpression(f) => Value::new(Kind::Function(FunctionValue {
                callable: Callable::Function(f),
                bindings: bindings.clone(),
                receiver: None,
            })),
            Expression::ObjectExpression(n) => {
                let mut v = Value::new(Kind::Object(n, bindings.clone()));
                v.ownership = Ownership::Shallow;
                v
            }
            Expression::ArrayExpression(n) => {
                let mut v = Value::new(Kind::Array(n, bindings.clone()));
                v.ownership = Ownership::Shallow;
                v
            }
            Expression::StaticMemberExpression(n) => {
                let object = self.resolve(&n.object, bindings, depth + 1);
                self.member(object, &n.property.name, depth + 1)
            }
            Expression::ComputedMemberExpression(n) => {
                let object = self.resolve(&n.object, bindings, depth + 1);
                let name = n.static_property_name().map(|s| s.to_string()).or_else(|| {
                    match self.resolve(&n.expression, bindings, depth + 1).kind {
                        Kind::Scalar(s) => s,
                        _ => None,
                    }
                });
                name.map(|name| self.member(object.clone(), &name, depth + 1))
                    .unwrap_or_else(|| Value::data().with_reads(&object))
            }
            Expression::CallExpression(call) => {
                if self.index.compiled_views.contains(&call.span) {
                    Value::new(Kind::Compiled)
                } else {
                    let callee = self.resolve(&call.callee, bindings, depth + 1);
                    let arguments = call
                        .arguments
                        .iter()
                        .filter_map(Argument::as_expression)
                        .map(|e| self.resolve(e, bindings, depth + 1))
                        .collect::<Vec<_>>();
                    self.returned(callee, &arguments, call.span, depth + 1)
                }
            }
            Expression::NewExpression(n) => {
                let callee = self.resolve(&n.callee, bindings, depth + 1);
                match callee.kind {
                    Kind::Global(ref root, ref path)
                        if (path.is_empty() || root == "Intl")
                            && [
                                "Array",
                                "Map",
                                "Set",
                                "Date",
                                "RegExp",
                                "Intl",
                                "URL",
                                "URLSearchParams",
                                "Error",
                                "TypeError",
                                "RangeError",
                                "SyntaxError",
                            ]
                            .contains(&root.as_str()) =>
                    {
                        Value::owned(false)
                    }
                    _ => Value::unknown("the result of this constructor"),
                }
            }
            Expression::ConditionalExpression(n) => {
                let a = self.resolve(&n.consequent, bindings, depth + 1);
                let b = self.resolve(&n.alternate, bindings, depth + 1);
                self.join(vec![a, b])
            }
            Expression::LogicalExpression(n) => {
                let a = self.resolve(&n.left, bindings, depth + 1);
                let b = self.resolve(&n.right, bindings, depth + 1);
                self.join(vec![a, b])
            }
            Expression::SequenceExpression(n) => n
                .expressions
                .last()
                .map(|e| self.resolve(e, bindings, depth + 1))
                .unwrap_or_else(Value::scalar),
            Expression::JSXElement(_) | Expression::JSXFragment(_) => {
                Value::new(if self.root.contains_inclusive(e.span()) {
                    Kind::Compiled
                } else {
                    Kind::RawJsx
                })
            }
            Expression::AssignmentExpression(n) => self.resolve(&n.right, bindings, depth + 1),
            Expression::AwaitExpression(_)
            | Expression::YieldExpression(_)
            | Expression::ImportExpression(_) => Value::unknown("an asynchronous value"),
            _ => Value::scalar(),
        };
        // This records lexical inputs even for unevaluated closures: their snapshot
        // identity is part of the value created by the expression.
        for reference in self.index.references(e.span()) {
            if let Some(input) = reference.symbol.and_then(|id| bindings.get(&id)) {
                value.reads.extend(&input.reads);
            }
        }
        if value.source.is_none() {
            value.source = Some((e.span(), vec![]));
        }
        self.observe(e.span(), &value);
        value
    }
    fn member(&mut self, mut object: Value<'a>, name: &str, depth: usize) -> Value<'a> {
        if depth > 80 {
            return Value::unknown("a member beyond the analysis depth limit");
        }
        if !object.ambient.is_empty() && self.ambient_written(&object.ambient) {
            return Value::unknown("a captured object whose properties can mutate")
                .with_reads(&object);
        }
        let mut selected = match object.kind.clone() {
            Kind::Object(n, bindings) => {
                let mut selected = None;
                for property in n.properties.iter().rev() {
                    match property {
                        ObjectPropertyKind::ObjectProperty(property) => {
                            let key =
                                self.key(&property.key, property.computed, &bindings, depth + 1);
                            if key.is_none() {
                                selected = Some(Value::unknown("a computed object property"));
                                break;
                            }
                            if key.as_deref() != Some(name) {
                                continue;
                            }
                            let mut value = self.resolve(&property.value, &bindings, depth + 1);
                            if let Kind::Function(function) = &mut value.kind {
                                function.receiver = Some(Box::new(object.clone()));
                            }
                            if property.kind == PropertyKind::Get {
                                self.invoke(value.clone(), &[], property.span, self.phase);
                                value = self.returned(value, &[], property.span, depth + 1);
                            }
                            selected = Some(value);
                            break;
                        }
                        ObjectPropertyKind::SpreadProperty(property) => {
                            let spread = self.resolve(&property.argument, &bindings, depth + 1);
                            if let Some(value) = self.known_field(spread, name, depth + 1) {
                                selected = Some(value);
                                break;
                            }
                        }
                    }
                }
                selected.unwrap_or_else(|| {
                    Value::new(Kind::Member(Box::new(object.clone()), name.into()))
                })
            }
            Kind::Array(n, bindings) => {
                if let Ok(position) = name.parse::<usize>() {
                    n.elements
                        .get(position)
                        .and_then(ArrayExpressionElement::as_expression)
                        .map(|e| self.resolve(e, &bindings, depth + 1))
                        .unwrap_or_else(Value::data)
                } else {
                    Value::new(Kind::Member(Box::new(object.clone()), name.into()))
                }
            }
            Kind::Native
                if object.ownership == Ownership::Deep && name.parse::<usize>().is_ok() =>
            {
                let mut value = Value::new(Kind::Native);
                value.ownership = Ownership::Deep;
                value
            }
            Kind::Global(root, mut path) => {
                path.push(name.into());
                Value::new(Kind::Global(root, path))
            }
            Kind::Import(root, mut path) => {
                path.push(name.into());
                Value::new(Kind::Import(root, path))
            }
            Kind::Api(root, mut path, callbacks) => {
                path.push(name.into());
                Value::new(Kind::Api(root, path, callbacks))
            }
            Kind::Union(values) => {
                let results = values
                    .into_iter()
                    .map(|v| self.member(v, name, depth + 1))
                    .collect();
                self.join(results)
            }
            Kind::Opaque => Value::unknown(
                "property access on an opaque captured value; pass its immutable result through the model",
            ),
            Kind::Unknown(_) => Value::new(Kind::Member(Box::new(object.clone()), name.into())),
            _ => Value::new(Kind::Member(Box::new(object.clone()), name.into())),
        };
        if object.ownership == Ownership::Deep {
            selected.ownership = Ownership::Deep;
        }
        if selected.source.is_none() {
            selected.source = object.source.clone().map(|(span, mut path)| {
                path.push(Some(name.into()));
                (span, path)
            });
        }
        selected.reads.append(&mut object.reads);
        selected.ambient.extend(object.ambient);
        selected
    }
    fn known_field(&mut self, object: Value<'a>, name: &str, depth: usize) -> Option<Value<'a>> {
        // Known empty spreads preserve earlier fields. An unresolved spread may
        // override every earlier field and must never be treated as absent.
        if let Kind::Object(n, bindings) = &object.kind {
            let mut possible = false;
            for property in &n.properties {
                match property {
                    ObjectPropertyKind::SpreadProperty(_) => {
                        possible = true;
                    }
                    ObjectPropertyKind::ObjectProperty(p) => {
                        let key = self.key(&p.key, p.computed, bindings, depth + 1);
                        possible |= key.is_none() || key.as_deref() == Some(name);
                    }
                }
            }
            if !possible {
                return None;
            }
        }
        Some(self.member(object, name, depth + 1))
    }
    fn ambient_written(&mut self, roots: &BTreeSet<SymbolId>) -> bool {
        if self.auditing_ambient {
            return false;
        }
        for root in roots {
            if let Some(written) = self.ambient_proofs.get(root) {
                if *written {
                    return true;
                }
                continue;
            }
            let roots = BTreeSet::from([*root]);
            let direct = self.index.writes.iter().any(|span| {
                self.index
                    .references(*span)
                    .next()
                    .and_then(|r| r.symbol)
                    .is_some_and(|id| self.aliases_root(id, &roots, &mut HashSet::new()))
            });
            let calls = self
                .index
                .calls
                .iter()
                .filter(|call| !self.index.compiled_views.contains(&call.span))
                .filter(|call| {
                    self.index.references(call.span).any(|r| {
                        r.symbol
                            .is_some_and(|id| self.aliases_root(id, &roots, &mut HashSet::new()))
                    })
                })
                .copied()
                .collect::<Vec<_>>();
            let mut written = direct;
            if !written {
                for call in calls {
                    // Reuse the same call/effect analysis. Disabling this recursive
                    // stability query does not grant ownership or suppress effects.
                    let mut audit = Analyzer {
                        index: self.index,
                        options: self.options,
                        phase: Phase::Render,
                        bindings: Rc::new(BTreeMap::new()),
                        receiver: None,
                        scopes: vec![call.span],
                        resolving: HashSet::new(),
                        checking: HashSet::new(),
                        certificate: Certificate::default(),
                        error: None,
                        root: call.span,
                        steps: 0,
                        slot_position: false,
                        auditing_ambient: true,
                        ambient_proofs: HashMap::new(),
                        audit_root: Some(*root),
                        ambient_mutated: false,
                    };
                    let callee = audit.expression_value(&call.callee);
                    let arguments = call
                        .arguments
                        .iter()
                        .filter_map(Argument::as_expression)
                        .map(|e| audit.expression_value(e))
                        .collect::<Vec<_>>();
                    audit.invoke(callee, &arguments, call.span, Phase::Render);
                    if audit.ambient_mutated {
                        written = true;
                        break;
                    }
                }
            }
            self.ambient_proofs.insert(*root, written);
            if written {
                return true;
            }
        }
        false
    }
    fn aliases_root(
        &self,
        id: SymbolId,
        roots: &BTreeSet<SymbolId>,
        seen: &mut HashSet<SymbolId>,
    ) -> bool {
        roots.contains(&id)
            || (seen.insert(id)
                && self.index.initializers.get(&id).is_some_and(|e| {
                    self.index.references(e.span()).any(|r| {
                        r.symbol
                            .is_some_and(|id| self.aliases_root(id, roots, seen))
                    })
                }))
    }
    fn arguments(
        &mut self,
        function: &FunctionValue<'a>,
        arguments: &[Value<'a>],
        depth: usize,
    ) -> Rc<Bindings<'a>> {
        let mut bindings = (*function.bindings).clone();
        for (position, parameter) in function.callable.params().items.iter().enumerate() {
            let mut input = arguments.get(position).cloned().unwrap_or_else(Value::data);
            if let Some(initializer) = &parameter.initializer {
                let previous = self.bindings.clone();
                self.bindings = Rc::new(bindings.clone());
                self.visit_expression(initializer);
                let default = self.expression_value(initializer);
                self.bindings = previous;
                input = self.join(vec![input, default]);
            }
            self.bind(&parameter.pattern, input, &mut bindings, depth + 1);
        }
        if let Some(rest) = &function.callable.params().rest {
            self.bind(
                &rest.rest.argument,
                Value::owned(false),
                &mut bindings,
                depth + 1,
            );
        }
        Rc::new(bindings)
    }
    fn returned(
        &mut self,
        callee: Value<'a>,
        arguments: &[Value<'a>],
        span: Span,
        depth: usize,
    ) -> Value<'a> {
        if depth > 80 {
            return Value::unknown("a function's recursive return value");
        }
        let mut value = match callee.kind.clone() {
            Kind::Function(function) => {
                let bindings = self.arguments(&function, arguments, depth + 1);
                let old_receiver = self.receiver.clone();
                self.receiver = function.receiver.as_deref().cloned();
                self.scopes.push(function.callable.span());
                let expressions = return_expressions(function.callable);
                let values = expressions
                    .into_iter()
                    .map(|e| self.resolve(e, &bindings, depth + 1))
                    .collect::<Vec<_>>();
                let result = if values.is_empty() {
                    Value::scalar()
                } else {
                    self.join(values)
                };
                self.scopes.pop();
                self.receiver = old_receiver;
                result
            }
            Kind::Union(values) => {
                let values = values
                    .into_iter()
                    .map(|callee| self.returned(callee, arguments, span, depth + 1))
                    .collect();
                self.join(values)
            }
            Kind::Global(ref root, ref path) if root == "structuredClone" && path.is_empty() => {
                Value::owned(true)
            }
            Kind::Global(ref root, ref path)
                if root == "Object" && path.as_slice() == ["assign"] =>
            {
                let mut value = arguments.first().cloned().unwrap_or_else(Value::data);
                // The source object's fields have changed. Any later intrinsic
                // guard must validate the completed call, not its initial target.
                value.kind = Kind::Data;
                value.source = Some((span, vec![]));
                value
            }
            Kind::Global(ref root, ref path)
                if root == "Array"
                    && matches!(path.first().map(String::as_str), Some("from" | "of")) =>
            {
                Value::owned(false)
            }
            Kind::Global(ref root, ref path) if root == "<dispatch>" && path.is_empty() => {
                Value::scalar()
            }
            Kind::Member(ref receiver, ref method)
                if [
                    "slice",
                    "map",
                    "filter",
                    "concat",
                    "flat",
                    "flatMap",
                    "toSorted",
                    "toReversed",
                    "toSpliced",
                ]
                .contains(&method.as_str())
                    && !matches!(receiver.kind, Kind::Object(..) | Kind::Unknown(_)) =>
            {
                Value::owned(
                    receiver.ownership == Ownership::Deep && method != "map" && method != "flatMap",
                )
            }
            Kind::Member(ref receiver, ref method)
                if ["sort", "reverse", "fill", "copyWithin"].contains(&method.as_str()) =>
            {
                *receiver.clone()
            }
            Kind::Member(_, ref method)
                if matches!(method.as_str(), "split" | "matchAll" | "match") =>
            {
                Value::owned(true)
            }
            Kind::Member(_, ref method)
                if matches!(
                    method.as_str(),
                    "join"
                        | "toUpperCase"
                        | "toLowerCase"
                        | "toLocaleUpperCase"
                        | "toLocaleLowerCase"
                        | "trim"
                        | "trimStart"
                        | "trimEnd"
                        | "replace"
                        | "replaceAll"
                        | "substring"
                        | "substr"
                        | "charAt"
                        | "normalize"
                        | "padStart"
                        | "padEnd"
                        | "repeat"
                        | "toString"
                        | "toLocaleString"
                        | "toFixed"
                        | "toPrecision"
                        | "toExponential"
                        | "toISOString"
                        | "toLocaleDateString"
                        | "toLocaleTimeString"
                ) =>
            {
                Value::scalar()
            }
            Kind::Member(ref receiver, ref method)
                if matches!(method.as_str(), "at" | "get" | "find" | "findLast") =>
            {
                let mut result = Value::data().with_reads(receiver);
                result.ambient = receiver.ambient.clone();
                if receiver.ownership == Ownership::Deep {
                    result.kind = Kind::Native;
                    result.ownership = Ownership::Deep;
                }
                result.source = receiver.source.clone().map(|(span, mut path)| {
                    path.push(None);
                    (span, path)
                });
                result
            }
            Kind::Member(_, ref method) if pure_method(method) => Value::data(),
            Kind::Import(ref module, ref path)
                if self.framework(module)
                    && matches!(
                        path.first().map(String::as_str),
                        Some("domMount" | "domBinding" | "effectEvent" | "slot")
                    ) =>
            {
                Value::new(Kind::Compiled)
            }
            Kind::Import(ref module, ref path)
                if self.framework(module)
                    && [
                        "defineActions",
                        "defineTasks",
                        "defineField",
                        "collection",
                        "resourceComponent",
                        "taskComponent",
                        "component",
                    ]
                    .contains(&path.first().map(String::as_str).unwrap_or("")) =>
            {
                Value::new(Kind::Api(module.clone(), path.clone(), arguments.to_vec()))
            }
            Kind::Api(ref module, _, _) if !self.framework(module) => Value::data(),
            Kind::Api(_, ref path, _)
                if path.first().is_some_and(|name| name == "collection")
                    && path.last().is_some_and(|name| name == "from") =>
            {
                Value::new(Kind::Native)
            }
            Kind::Api(ref module, ref path, ref callbacks) => Value::new(Kind::Api(
                module.clone(),
                path.clone(),
                callbacks
                    .iter()
                    .cloned()
                    .chain(arguments.iter().cloned())
                    .collect(),
            )),
            Kind::Import(ref module, ref path)
                if (module == "effect" && path.first().is_some_and(|name| name == "Schema")
                    || module == "effect/Schema")
                    && path.last().is_some_and(|name| {
                        matches!(
                            name.as_str(),
                            "decodeUnknownSync"
                                | "decodeSync"
                                | "encodeSync"
                                | "encodeUnknownSync"
                                | "is"
                        )
                    }) =>
            {
                Value::new(Kind::Api(module.clone(), path.clone(), vec![]))
            }
            Kind::Import(ref module, ref path) if self.trusted_import(module, path) => {
                Value::data()
            }
            Kind::Global(ref root, _)
                if [
                    "Math",
                    "Date",
                    "JSON",
                    "String",
                    "Number",
                    "Boolean",
                    "BigInt",
                    "Object",
                    "Array",
                    "RegExp",
                    "Intl",
                    "encodeURIComponent",
                    "decodeURIComponent",
                    "parseInt",
                    "parseFloat",
                    "isNaN",
                    "isFinite",
                ]
                .contains(&root.as_str()) =>
            {
                Value::data()
            }
            Kind::Member(..) => Value::data(),
            Kind::Compiled => Value::new(Kind::Compiled),
            _ => Value::unknown("the result of an opaque call; declare its import contract"),
        };
        value.reads.extend(&callee.reads);
        for argument in arguments {
            value.reads.extend(&argument.reads);
        }
        self.observe(span, &value);
        value
    }
    fn framework(&self, module: &str) -> bool {
        self.options.import_source.as_deref().is_some_and(|root| {
            module == root
                || module
                    .strip_prefix(root)
                    .is_some_and(|rest| rest.starts_with('/'))
        })
    }
    fn trusted_import(&self, module: &str, path: &[String]) -> bool {
        self.framework(module)
            || module == "effect"
            || module.starts_with("effect/")
            || self
                .options
                .pure_imports
                .get(module)
                .is_some_and(|names| names.contains(&path.join(".")))
    }
    fn check_value(&mut self, value: &Value<'a>, span: Span) {
        if self.phase != Phase::Render {
            return;
        }
        if matches!(value.kind, Kind::RawJsx) {
            self.fail(Issue::invalid(span,"This capture contains uncompiled JSX outside a view. Export a compiled view, or declare a local template or slot."));
        }
        if let Kind::Unknown(reason) = &value.kind {
            self.fail(Issue::unknown(span, reason));
        }
        if let Kind::Global(root, path) = &value.kind
            && ([
                "globalThis",
                "self",
                "performance",
                "crypto",
                "navigator",
                "location",
                "window",
                "document",
                "localStorage",
                "sessionStorage",
            ]
            .contains(&root.as_str())
                || (root == "Date"
                    && !path.is_empty()
                    && !matches!(path.last().map(String::as_str), Some("UTC" | "parse"))))
        {
            self.fail(Issue::invalid(
                span,
                format!("Read {root} in a command or DOM host, then put its result in the model."),
            ));
        }
        if !value.ambient.is_empty() && self.ambient_written(&value.ambient) {
            self.fail(Issue::unknown(
                span,
                "a captured object whose properties can mutate",
            ));
        }
    }
    fn invoke(&mut self, value: Value<'a>, arguments: &[Value<'a>], span: Span, phase: Phase) {
        if self.error.is_some() {
            return;
        }
        if self.auditing_ambient {
            let opaque = match &value.kind {
                Kind::Unknown(_) | Kind::Opaque => true,
                Kind::Import(module, path) => !self.trusted_import(module, path),
                Kind::Member(_, method) => !pure_method(method) && !mutator(method),
                _ => false,
            };
            if opaque
                && self.audit_root.is_some_and(|root| {
                    value.ambient.contains(&root)
                        || arguments
                            .iter()
                            .any(|argument| argument.ambient.contains(&root))
                })
            {
                self.ambient_mutated = true;
            }
        }
        match value.kind.clone() {
            Kind::Function(function)=>{
                if function.callable.asynchronous()&&phase==Phase::Event {self.fail(Issue::invalid(span,"Async work belongs in commands. Event handlers dispatch synchronously."));return;}
                if self.index.uncompiled_jsx(function.callable.span())&&!self.root.contains_inclusive(function.callable.span()) {self.fail(Issue::invalid(span,"This capture contains uncompiled JSX outside a view. Export a compiled view, or declare a local template or slot."));return;}
                if !self.checking.insert((function.callable.span(),phase)){self.fail(Issue::unknown(span,"recursive helper effects. Recursive JSX helpers are unsupported; use an iterative helper with explicit inputs."));return;}
                let previous=(self.phase,self.bindings.clone(),self.receiver.clone());
                self.phase=phase;self.bindings=self.arguments(&function,arguments,0);self.receiver=function.receiver.as_deref().cloned();self.scopes.push(function.callable.span());
                match function.callable {Callable::Arrow(f)=>self.visit_arrow_function_body(&f.body),Callable::Function(f)=>{if let Some(body)=&f.body{self.visit_function_body(body);}}}
                self.scopes.pop();self.phase=previous.0;self.bindings=previous.1;self.receiver=previous.2;
                self.checking.remove(&(function.callable.span(),phase));
            }
            Kind::Union(values)=>for value in values {self.invoke(value,arguments,span,phase);},
            Kind::Unknown(reason) if phase==Phase::Render=>self.fail(Issue::unknown(span,format!("the purity of this call ({reason}). Move effects to a command or declare an explicit import contract."))),
            Kind::Api(module,path,callbacks)=>{
                if path.first().is_some_and(|name|name=="collection") {
                    let mut input=Value::data();
                    if let Some(argument)=arguments.first(){input.reads.extend(&argument.reads);input.source=argument.source.clone().map(|(span,mut path)|{path.push(None);(span,path)});}
                    for callback in callbacks{if matches!(callback.kind,Kind::Function(_)){self.invoke(callback,&[input.clone()],span,phase);}}
                }
                if phase==Phase::Render&&self.framework(&module)&&!matches!(path.last().map(String::as_str),Some("defineActions"|"defineTasks"|"defineField"|"collection"|"resourceComponent"|"taskComponent"|"component"|"bind"|"controls"|"from"|"map"|"view")) {self.fail(Issue::unknown(span,format!("framework method {} is a render operation",path.join("."))));}
                for argument in arguments{if matches!(argument.kind,Kind::Function(_)){self.invoke(argument.clone(),&[Value::data()],span,if matches!(path.last().map(String::as_str),Some("map"|"from")){phase}else{Phase::Host});}}
                let _=module;
            }
            Kind::Import(module,path)=>{
                let (namespace,operation)=if module=="effect" {(path.first().map(String::as_str).unwrap_or(""),path.get(1).map(String::as_str).unwrap_or(""))}else{(module.strip_prefix("effect/").unwrap_or(""),path.first().map(String::as_str).unwrap_or(""))};
                if phase==Phase::Render&&(namespace.starts_with("Mutable")||(namespace=="DateTime"&&matches!(operation,"nowUnsafe"|"isFutureUnsafe"|"isPastUnsafe"))){self.fail(Issue::invalid(span,"Read or mutate ambient Effect state in a command or DOM host, then publish immutable data in the model."));return;}
                if namespace.starts_with("Mutable")&&matches!(operation,"set"|"setAndGet"|"update"|"modify"|"remove"|"delete"|"clear"|"add")&& let Some(target)=arguments.first(){self.check_mutation(target,span,operation,phase);}
                if phase==Phase::Render&&self.framework(&module)&&matches!(path.first().map(String::as_str),Some("mountView"|"modelOwner"|"observeBindings"|"inspectBindings"|"mountBindingInspector"|"observePrograms"|"uiRuntime"|"makeQueryCache"|"observeQuery"|"lifetime"|"projectionCache"|"sessionGroup"|"keyedTasks"|"program"|"queryResource"|"infiniteResource")){self.fail(Issue::invalid(span,"Create owned resources and perform mounting in a command, component owner, or DOM host."));return;}
                if phase==Phase::Render&&!self.trusted_import(&module,&path){self.fail(Issue::unknown(span,format!("the imported call {} from {module:?} is pure. Add its exported name to pureImports after checking its implementation, or move the call to a command.",path.join("."))));return;}
                if phase==Phase::Render&&((module=="effect"&&path.first().is_some_and(|p|p=="Effect")&&path.get(1).is_some_and(|p|p.starts_with("run")))||(module=="effect/Effect"&&path.first().is_some_and(|p|p.starts_with("run")))) {self.fail(Issue::invalid(span,"Run effects in a command or DOM host, then put results in the model."));return;}
                for (position, argument) in arguments.iter().enumerate() {
                    let callback_phase = if (module == "effect" && path.first().is_some_and(|name| name == "Effect")) || module == "effect/Effect" {
                        Some(Phase::Host)
                    } else if self.framework(&module) {
                        match (path.last().map(String::as_str), position) {
                            (Some("domMount"), 0) | (Some("domBinding" | "effectEvent"), 1) => Some(Phase::Host),
                            (Some("inputText" | "inputNumber" | "inputChecked" | "submit" | "keyDown"), 0) => Some(Phase::Event),
                            _ => None,
                        }
                    } else if module == "effect" || module.starts_with("effect/") { Some(phase) } else { None };
                    if let Some(callback_phase) = callback_phase && argument.callable() {
                        self.invoke(argument.clone(), &[Value::data()], span, callback_phase);
                    }
                }
            }
            Kind::Global(root,path)=>{
                let previous=self.phase;self.phase=phase;self.check_value(&value,span);self.phase=previous;
                if phase==Phase::Render&&root=="Date"&&path.is_empty(){self.fail(Issue::invalid(span,"Read Date in a command or DOM host, then put its result in the model."));}
                if phase==Phase::Render&&root=="Math"&&path.as_slice()==["random"]{self.fail(Issue::invalid(span,"Read randomness in a command, then put its result in the model."));}
                if matches!((root.as_str(),path.last().map(String::as_str)),("Object",Some("assign"|"defineProperty"|"defineProperties"|"setPrototypeOf"))|("Reflect",Some("set"|"defineProperty"|"deleteProperty"|"setPrototypeOf"))){
                    if let Some(target) = arguments.first() {
                        if phase == Phase::Render && (path.last().is_none_or(|name|name != "assign") || matches!(target.kind, Kind::Native | Kind::Array(..)) || self.callable_fields(target)) {
                            self.fail(Issue::unknown(span, "callable provenance after reconfiguring an object. Construct helper behavior during setup; render helpers may copy and mutate private data."));
                            return;
                        }
                        self.check_mutation(target, span, "operation", phase);
                    }
                }
                else if root=="Array"&&path.len()>=3&&path[0]=="prototype"&&matches!(path.last().map(String::as_str),Some("call"|"apply")){if let Some(target)=arguments.first()&& mutator(&path[1]){self.check_mutation(target,span,&path[1],phase);}}
                else if phase==Phase::Render&&!known_global(&root,&path){self.fail(Issue::unknown(span,format!("the global call {root} is pure. Import a checked helper or move it to a command.")));}
                for argument in arguments{if argument.callable(){
                    let mut input=Value::data();
                    for value in arguments{input.reads.extend(&value.reads);}
                    if root=="Array"&&path.first().is_some_and(|name|name=="from") {input.source=arguments.first().and_then(|value|value.source.clone()).map(|(span,mut path)|{path.push(None);(span,path)});}
                    self.invoke(argument.clone(),&[input],span,phase);
                }}
            }
            Kind::Member(receiver,method)=>{
                if phase==Phase::Render&&self.slot_position&&!mutator(&method)&&!pure_method(&method)&&!value.reads.is_empty()
                    && let Some((source,path))=&value.source
                        && self.root.contains_inclusive(*source){
                            let guards=self.certificate.guards.entry(*source).or_default();let guard=(path.clone(),"@slot".to_string());if !guards.contains(&guard){guards.push(guard);}return;
                        }
                if mutator(&method){self.check_mutation(&receiver,span,&method,phase);if self.error.is_some(){return;}}
                let compiled_list=method=="map"&&self.index.calls.iter().any(|call|call.span==span&&call.arguments.first().and_then(Argument::as_expression).is_some_and(|e|matches!(unwrap(e),Expression::ArrowFunctionExpression(f) if crate::analysis::contains_jsx_body(&f.body))));
                if phase==Phase::Render && !self.auditing_ambient && !compiled_list && (mutator(&method)||pure_method(&method))
                    && !matches!(receiver.kind,Kind::Native|Kind::Array(..)|Kind::Scalar(_)) {
                        if let Some((source,path))=&receiver.source {
                            if self.root.contains_inclusive(*source) {
                                let guards=self.certificate.guards.entry(*source).or_default();
                                let guard=(path.clone(),method.clone());if !guards.contains(&guard){guards.push(guard);}
                            }else{self.fail(Issue::unknown(span,"the intrinsic receiver outside this view; pass it as an explicit helper argument"));}
                        }else{self.fail(Issue::unknown(span,"the identity of this data operation"));}
                    }
                if !mutator(&method) && phase==Phase::Render&&!pure_method(&method){self.fail(Issue::unknown(span,format!("method {method} is pure. Use a known data operation or an imported helper with a purity contract.")));}
                for argument in arguments{if argument.callable(){let mut input=Value::data().with_reads(&receiver);
                    if receiver.ownership==Ownership::Deep { input.kind=Kind::Native;input.ownership=Ownership::Deep; }
                    input.source=receiver.source.clone().map(|(span,mut path)|{path.push(None);(span,path)});
                    self.invoke(argument.clone(),&[input.clone(),input],span,phase);}}
            }
            Kind::Compiled=>{},
            _ if phase==Phase::Render=>self.fail(Issue::unknown(span,"this value is callable and pure")),
            _=>{},
        }
    }
    fn check_mutation(&mut self, target: &Value<'a>, span: Span, operation: &str, phase: Phase) {
        if self.auditing_ambient {
            self.ambient_mutated |= self
                .audit_root
                .is_some_and(|root| target.ambient.contains(&root));
            return;
        }
        if target.ownership != Ownership::Borrowed {
            return;
        }
        // Effects may update external services, but never a borrowed snapshot.
        if phase != Phase::Render && target.reads.is_empty() {
            return;
        }
        self.fail(Issue::invalid(span,format!("Views cannot call mutating method {operation} on borrowed data. Views do not mutate snapshots; use an owned copy or a command.")));
    }
}
fn mutator(name: &str) -> bool {
    matches!(
        name,
        "push"
            | "pop"
            | "shift"
            | "unshift"
            | "splice"
            | "sort"
            | "reverse"
            | "copyWithin"
            | "fill"
            | "set"
            | "add"
            | "delete"
            | "clear"
            | "setTime"
            | "setDate"
            | "setFullYear"
            | "setMonth"
            | "setHours"
            | "setMinutes"
            | "setSeconds"
            | "setMilliseconds"
    )
}
fn pure_method(name: &str) -> bool {
    matches!(
        name,
        "slice"
            | "map"
            | "filter"
            | "flatMap"
            | "flat"
            | "reduce"
            | "reduceRight"
            | "find"
            | "findLast"
            | "findIndex"
            | "findLastIndex"
            | "every"
            | "some"
            | "includes"
            | "indexOf"
            | "lastIndexOf"
            | "join"
            | "concat"
            | "at"
            | "toSorted"
            | "toReversed"
            | "toSpliced"
            | "with"
            | "entries"
            | "keys"
            | "values"
            | "has"
            | "get"
            | "forEach"
            | "toString"
            | "toLocaleString"
            | "toUpperCase"
            | "toLowerCase"
            | "toLocaleUpperCase"
            | "toLocaleLowerCase"
            | "trim"
            | "trimStart"
            | "trimEnd"
            | "split"
            | "replace"
            | "replaceAll"
            | "match"
            | "matchAll"
            | "search"
            | "test"
            | "exec"
            | "startsWith"
            | "endsWith"
            | "substring"
            | "substr"
            | "charAt"
            | "charCodeAt"
            | "codePointAt"
            | "normalize"
            | "padStart"
            | "padEnd"
            | "repeat"
            | "localeCompare"
            | "toFixed"
            | "toPrecision"
            | "toExponential"
            | "getTime"
            | "getDate"
            | "getDay"
            | "getFullYear"
            | "getMonth"
            | "getHours"
            | "getMinutes"
            | "getSeconds"
            | "getMilliseconds"
            | "toISOString"
            | "toLocaleDateString"
            | "toLocaleTimeString"
            | "format"
    )
}
fn known_global(root: &str, path: &[String]) -> bool {
    matches!(
        root,
        "Math"
            | "JSON"
            | "String"
            | "Number"
            | "Boolean"
            | "BigInt"
            | "Object"
            | "Array"
            | "RegExp"
            | "Intl"
            | "encodeURI"
            | "encodeURIComponent"
            | "decodeURI"
            | "decodeURIComponent"
            | "parseInt"
            | "parseFloat"
            | "isNaN"
            | "isFinite"
            | "structuredClone"
            | "<dispatch>"
    ) || (root == "Date" && matches!(path.last().map(String::as_str), Some("UTC" | "parse")))
}
fn return_expressions<'a>(callable: Callable<'a>) -> Vec<&'a Expression<'a>> {
    struct Returns<'a>(Vec<&'a Expression<'a>>);
    impl<'a> Visit<'a> for Returns<'a> {
        fn visit_return_statement(&mut self, n: &ReturnStatement<'a>) {
            let n = self.alloc(n);
            if let Some(value) = &n.argument {
                self.0.push(value);
            }
        }
        fn visit_function(&mut self, _: &Function<'a>, _: oxc::syntax::scope::ScopeFlags) {}
        fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
    }
    let mut visitor = Returns(vec![]);
    match callable {
        Callable::Arrow(f) => match &f.body {
            ArrowFunctionBody::FunctionBody(body) => visitor.visit_function_body(body),
            body => visitor.0.push(body.as_expression().unwrap()),
        },
        Callable::Function(f) => {
            if let Some(body) = &f.body {
                visitor.visit_function_body(body)
            }
        }
    }
    visitor.0
}
impl<'a> Analyzer<'a, '_> {
    fn expression_value(&mut self, e: &'a Expression<'a>) -> Value<'a> {
        self.resolve(e, &self.bindings.clone(), 0)
    }
    fn callable_fields(&self, value: &Value<'a>) -> bool {
        match &value.kind {
            Kind::Object(object, _) => object.properties.iter().any(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    property.kind != PropertyKind::Init
                        || matches!(
                            unwrap(&property.value),
                            Expression::ArrowFunctionExpression(_)
                                | Expression::FunctionExpression(_)
                        )
                }
                ObjectPropertyKind::SpreadProperty(_) => true,
            }),
            Kind::Union(values) => values.iter().any(|value| self.callable_fields(value)),
            _ => false,
        }
    }
    fn property_write(&mut self, target: &Value<'a>, name: Option<&str>, span: Span) {
        if self.phase != Phase::Render {
            return;
        }
        let native_method = matches!(target.kind, Kind::Native | Kind::Array(..))
            && name.is_none_or(|name| pure_method(name) || mutator(name));
        let callable = match name {
            Some(name) => self.member(target.clone(), name, 0).callable(),
            None => self.callable_fields(target),
        };
        if native_method || callable {
            self.fail(Issue::unknown(span, "callable provenance after a property write. Construct helpers during setup; render helpers may mutate only their private data."));
        }
    }
    fn mutation_target(&mut self, target: &'a AssignmentTarget<'a>, span: Span) {
        match target {
            AssignmentTarget::AssignmentTargetIdentifier(id) => self.mutate_binding(id, span),
            AssignmentTarget::StaticMemberExpression(n) => {
                self.visit_expression(&n.object);
                let value = self.expression_value(&n.object);
                self.property_write(&value, Some(&n.property.name), span);
                self.check_mutation(&value, span, "assignment", self.phase);
            }
            AssignmentTarget::ComputedMemberExpression(n) => {
                self.visit_expression(&n.object);
                self.visit_expression(&n.expression);
                let value = self.expression_value(&n.object);
                let name = self.expression_value(&n.expression);
                self.property_write(
                    &value,
                    match &name.kind {
                        Kind::Scalar(name) => name.as_deref(),
                        _ => None,
                    },
                    span,
                );
                self.check_mutation(&value, span, "assignment", self.phase);
            }
            _ => self.fail(Issue::unknown(
                span,
                "ownership for this assignment target; use named local bindings",
            )),
        }
    }
    fn simple_mutation_target(&mut self, target: &'a SimpleAssignmentTarget<'a>, span: Span) {
        match target {
            SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => self.mutate_binding(id, span),
            SimpleAssignmentTarget::StaticMemberExpression(n) => {
                self.visit_expression(&n.object);
                let value = self.expression_value(&n.object);
                self.check_mutation(&value, span, "assignment", self.phase);
            }
            SimpleAssignmentTarget::ComputedMemberExpression(n) => {
                self.visit_expression(&n.object);
                self.visit_expression(&n.expression);
                let value = self.expression_value(&n.object);
                self.check_mutation(&value, span, "assignment", self.phase);
            }
            _ => self.fail(Issue::unknown(
                span,
                "ownership for this assignment target; use named local bindings",
            )),
        }
    }
    fn mutate_binding(&mut self, id: &IdentifierReference<'_>, span: Span) {
        let local = self.index.symbol(id).is_some_and(|id| self.local(id));
        if !local && self.phase == Phase::Render {
            self.fail(Issue::invalid(
                span,
                "Views do not mutate state. Dispatch a message and change the model in update.",
            ));
        }
    }
    fn embedded(&mut self, value: Value<'a>, span: Span, depth: usize) {
        if depth > 80 {
            self.fail(Issue::unknown(span, "the effects of nested callback data"));
            return;
        }
        match value.kind {
            Kind::Function(ref function) => {
                let jsx = match function.callable {
                    Callable::Arrow(f) => crate::analysis::contains_jsx_body(&f.body),
                    Callable::Function(f) => self
                        .index
                        .jsx
                        .iter()
                        .any(|span| f.span.contains_inclusive(*span)),
                };
                self.invoke(
                    value,
                    &[Value::data()],
                    span,
                    if jsx { Phase::Render } else { Phase::Event },
                );
            }
            Kind::Object(object, bindings) => {
                for property in &object.properties {
                    match property {
                        ObjectPropertyKind::ObjectProperty(p) => {
                            let field = self.resolve(&p.value, &bindings, 0);
                            self.embedded(field, p.span, depth + 1);
                        }
                        ObjectPropertyKind::SpreadProperty(p) => {
                            let field = self.resolve(&p.argument, &bindings, 0);
                            self.embedded(field, p.span, depth + 1);
                        }
                    }
                }
            }
            Kind::Array(array, bindings) => {
                for e in array
                    .elements
                    .iter()
                    .filter_map(ArrayExpressionElement::as_expression)
                {
                    let field = self.resolve(e, &bindings, 0);
                    self.embedded(field, e.span(), depth + 1);
                }
            }
            _ => {}
        }
    }
    fn attribute_value(&mut self, e: &'a Expression<'a>) {
        let slot_position = self.slot_position;
        self.slot_position = false;
        self.visit_expression(e);
        let value = self.expression_value(e);
        if let Kind::Function(function) = &value.kind {
            let jsx = match function.callable {
                Callable::Arrow(f) => crate::analysis::contains_jsx_body(&f.body),
                Callable::Function(_) => false,
            };
            self.invoke(
                value,
                &[Value::owned(true)],
                e.span(),
                if jsx { Phase::Render } else { Phase::Event },
            );
        } else if value.callable() {
            self.invoke(value, &[Value::owned(true)], e.span(), Phase::Event);
        } else {
            self.embedded(value, e.span(), 0);
        }
        self.slot_position = slot_position;
    }
}
impl<'a> Visit<'a> for Analyzer<'a, '_> {
    fn visit_ts_type(&mut self, _: &TSType<'a>) {}
    fn visit_expression(&mut self, e: &Expression<'a>) {
        let e = self.alloc(e);
        if self.error.is_some() {
            return;
        }
        self.steps += 1;
        if self.steps > 100_000 {
            self.fail(Issue::unknown(
                e.span(),
                "render semantics within the analysis budget",
            ));
            return;
        }
        // Creation of a closure does not execute it. Call sites and JSX/host
        // boundaries supply its phase, regardless of its spelling or location.
        if matches!(
            unwrap(e),
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        ) {
            return;
        }
        walk::walk_expression(self, e);
        if self.error.is_none() {
            let value = self.expression_value(e);
            self.observe(e.span(), &value);
        }
    }
    fn visit_function(&mut self, _: &Function<'a>, _: oxc::syntax::scope::ScopeFlags) {}
    fn visit_arrow_function_expression(&mut self, _: &ArrowFunctionExpression<'a>) {}
    fn visit_variable_declarator(&mut self, n: &VariableDeclarator<'a>) {
        let previous = self.slot_position;
        self.slot_position = false;
        walk::walk_variable_declarator(self, n);
        self.slot_position = previous;
    }
    fn visit_for_of_statement(&mut self, n: &ForOfStatement<'a>) {
        let n = self.alloc(n);
        self.visit_expression(&n.right);
        let iterable = self.expression_value(&n.right);
        let mut element = Value::data().with_reads(&iterable);
        if iterable.ownership == Ownership::Deep {
            element.kind = Kind::Native;
            element.ownership = Ownership::Deep;
        }
        element.source = iterable.source.map(|(span, mut path)| {
            path.push(None);
            (span, path)
        });
        let previous = self.bindings.clone();
        if let ForStatementLeft::VariableDeclaration(declaration) = &n.left {
            let mut bindings = (*previous).clone();
            for variable in &declaration.declarations {
                self.bind(&variable.id, element.clone(), &mut bindings, 0);
            }
            self.bindings = Rc::new(bindings);
        }
        self.visit_statement(&n.body);
        self.bindings = previous;
    }
    fn visit_jsx_expression_container(&mut self, n: &JSXExpressionContainer<'a>) {
        let previous = self.slot_position;
        self.slot_position = true;
        walk::walk_jsx_expression_container(self, n);
        self.slot_position = previous;
    }
    fn visit_identifier_reference(&mut self, id: &IdentifierReference<'a>) {
        let id = self.alloc(id);
        if let Some(symbol) = self.index.symbol(id) {
            if self.phase == Phase::Render && !self.local(symbol) {
                let value = self.symbol(symbol, &self.bindings.clone(), 0);
                self.check_value(&value, id.span);
                if self
                    .index
                    .initializers
                    .get(&symbol)
                    .is_some_and(|e| self.index.uncompiled_jsx(e.span()))
                {
                    self.fail(Issue::invalid(id.span,"This capture contains uncompiled JSX outside a view. Export a compiled view, or declare a local template or slot."));
                }
            }
            if self.phase == Phase::Render
                && self.scopes.last() == Some(&self.root)
                && self.local(symbol)
                && !self.bindings.contains_key(&symbol)
            {
                let flags = self.index.scoping.symbol_flags(symbol);
                if (flags.is_variable()
                    && !flags.is_const_variable()
                    && !flags.is_function_scoped_declaration())
                    || self.index.scoping.symbol_is_mutated(symbol)
                {
                    self.fail(Issue::unknown(id.span,format!("Mutable capture {} is not a model dependency. Pass immutable data through the model.",id.name)));
                }
            }
        } else if id.name != "Date" {
            self.check_value(
                &Value::new(Kind::Global(id.name.to_string(), vec![])),
                id.span,
            );
        }
    }
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let call = self.alloc(call);
        if self.index.compiled_views.contains(&call.span) {
            return;
        }
        self.visit_expression(&call.callee);
        for argument in &call.arguments {
            match argument {
                Argument::SpreadElement(spread) => self.visit_expression(&spread.argument),
                _ => {
                    if let Some(e) = argument.as_expression() {
                        self.visit_expression(e);
                    }
                }
            }
        }
        if self.error.is_some() {
            return;
        }
        let callee = self.expression_value(&call.callee);
        let arguments = call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .map(|e| self.expression_value(e))
            .collect::<Vec<_>>();
        self.invoke(callee, &arguments, call.span, self.phase);
    }
    fn visit_tagged_template_expression(&mut self, n: &TaggedTemplateExpression<'a>) {
        let n = self.alloc(n);
        self.visit_expression(&n.tag);
        let mut arguments = vec![Value::new(Kind::Native)];
        for expression in &n.quasi.expressions {
            self.visit_expression(expression);
            arguments.push(self.expression_value(expression));
        }
        let callee = self.expression_value(&n.tag);
        self.invoke(callee, &arguments, n.span, self.phase);
    }
    fn visit_import_expression(&mut self, n: &ImportExpression<'a>) {
        if self.phase == Phase::Render || self.phase == Phase::Event {
            self.fail(Issue::invalid(
                n.span,
                "Async work belongs in commands or DOM hosts.",
            ));
        } else {
            walk::walk_import_expression(self, n);
        }
    }
    fn visit_new_expression(&mut self, n: &NewExpression<'a>) {
        let n = self.alloc(n);
        for argument in &n.arguments {
            if let Some(e) = argument.as_expression() {
                self.visit_expression(e);
            }
        }
        let callee = self.expression_value(&n.callee);
        if let Kind::Global(root, path) = &callee.kind {
            if root == "Date" && path.is_empty() && !n.arguments.is_empty() {
                return;
            }
            if [
                "Array",
                "Map",
                "Set",
                "RegExp",
                "URL",
                "URLSearchParams",
                "TextEncoder",
                "TextDecoder",
                "Error",
                "TypeError",
                "RangeError",
                "SyntaxError",
            ]
            .contains(&root.as_str())
                && path.is_empty()
            {
                return;
            }
        }
        self.invoke(callee, &[], n.span, self.phase);
    }
    fn visit_static_member_expression(&mut self, n: &StaticMemberExpression<'a>) {
        let n = self.alloc(n);
        self.visit_expression(&n.object);
        let object = self.expression_value(&n.object);
        let value = self.member(object, &n.property.name, 0);
        self.check_value(&value, n.span);
    }
    fn visit_computed_member_expression(&mut self, n: &ComputedMemberExpression<'a>) {
        let n = self.alloc(n);
        self.visit_expression(&n.object);
        self.visit_expression(&n.expression);
        let object = self.expression_value(&n.object);
        if let Some(name) = n.static_property_name() {
            let value = self.member(object, &name, 0);
            self.check_value(&value, n.span);
        }
    }
    fn visit_assignment_expression(&mut self, n: &AssignmentExpression<'a>) {
        let n = self.alloc(n);
        self.visit_expression(&n.right);
        if self.phase == Phase::Render
            && !matches!(n.left, AssignmentTarget::AssignmentTargetIdentifier(_))
            && self.expression_value(&n.right).callable()
        {
            self.fail(Issue::unknown(n.span, "callable provenance after assigning a function. Construct helper objects during setup."));
        }
        self.mutation_target(&n.left, n.span);
    }
    fn visit_update_expression(&mut self, n: &UpdateExpression<'a>) {
        let n = self.alloc(n);
        self.simple_mutation_target(&n.argument, n.span);
    }
    fn visit_unary_expression(&mut self, n: &UnaryExpression<'a>) {
        let n = self.alloc(n);
        if n.operator.as_str() == "delete" {
            match unwrap(&n.argument) {
                Expression::StaticMemberExpression(member) => {
                    self.visit_expression(&member.object);
                    let value = self.expression_value(&member.object);
                    self.check_mutation(&value, n.span, "delete", self.phase);
                }
                Expression::ComputedMemberExpression(member) => {
                    self.visit_expression(&member.object);
                    self.visit_expression(&member.expression);
                    let value = self.expression_value(&member.object);
                    self.check_mutation(&value, n.span, "delete", self.phase);
                }
                _ => self.fail(Issue::invalid(n.span, "Views do not mutate state.")),
            }
        } else {
            walk::walk_unary_expression(self, n);
        }
    }
    fn visit_await_expression(&mut self, n: &AwaitExpression<'a>) {
        let n = self.alloc(n);
        if self.phase == Phase::Render || self.phase == Phase::Event {
            self.fail(Issue::invalid(n.span, "Async work belongs in commands."));
        } else {
            walk::walk_await_expression(self, n);
        }
    }
    fn visit_jsx_attribute(&mut self, n: &JSXAttribute<'a>) {
        let n = self.alloc(n);
        if let Some(JSXAttributeValue::ExpressionContainer(container)) = &n.value {
            if let Some(e) = container.expression.as_expression() {
                self.attribute_value(e);
            }
        } else {
            walk::walk_jsx_attribute(self, n);
        }
    }
    fn visit_jsx_spread_attribute(&mut self, n: &JSXSpreadAttribute<'a>) {
        let n = self.alloc(n);
        if let Expression::ObjectExpression(object) = unwrap(&n.argument) {
            for property in &object.properties {
                match property {
                    ObjectPropertyKind::ObjectProperty(p) => {
                        if p.computed
                            && let Some(e) = p.key.as_expression()
                        {
                            self.visit_expression(e);
                        }
                        self.attribute_value(&p.value);
                    }
                    ObjectPropertyKind::SpreadProperty(p) => self.visit_expression(&p.argument),
                }
            }
        } else {
            self.visit_expression(&n.argument);
        }
    }
}
