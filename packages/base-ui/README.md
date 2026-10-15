# @effectweb/base-ui

Headless, accessible UI controls for EffectWeb, built without React.

Create a family handle in the parent, own its lifetime, and pass it explicitly to each part. Parts share state through that handle and accept native attributes; controlled values request changes through callbacks and wait for parent synchronization. Native checkbox, switch, and radio controls restore their initial state after an uncancelled form reset. Controlled controls request the initial value through their change callback and leave acceptance to the parent.

[Documentation](https://effectweb.netlify.app/docs/base-ui/) · [Repository](https://github.com/DerpyCrabs/EffectWeb)
