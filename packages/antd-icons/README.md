# @effectweb/antd-icons

EffectWeb adapter for the outlined and filled icons from `@ant-design/icons-svg`, using the upstream SVG definitions without React.

```tsx
import DeleteOutlined from '@effectweb/antd-icons/icons/DeleteOutlined';

<DeleteOutlined size={14} />;
```

Import each icon by its upstream name. There is no root barrel, so development servers load only imported icons. SVG attributes, `size` (defaults to `1em`) and an accessible `title` are supported. Icons without an accessible label are decorative.
