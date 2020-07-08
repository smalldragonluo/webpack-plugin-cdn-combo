webpack-plugin-cdn-combo
=================

**webpack-plugin-cdn-combo** 支持对 webpack async chunks 进行 CDN Combo 加载，提升网络性能：

Before:
```
单独请求每个资源
https://cdn.example.com/a.js
https://cdn.example.com/b.js
https://cdn.example.com/c.js
```

After:
```
// 并发请求被合并为同一个
https://cdn.example.com/a.js,b.js,c.js
```

因为浏览器实现中对于单域名的并发请求数限制，合并请求可以带来一定加载性能的提升，经测试可以减少 40-50% 的加载时间（HTTP 1.1）。

Installation
------------

```shell
tnpm install webpack-plugin-cdn-combo --save-dev
```

Usage
-----

```js
import WebpackPluginCdnCombo from 'webpack-plugin-cdn-combo';

export default {
  plugins: [
    new WebpackPluginCdnCombo({
      allowList: [
        '//cdn.smalldragonluo.com',
        '//cdn.example.com'
      ]
    })
  ]
}
```

React async component:

```jsx
import React, { lazy, Suspense } from 'react';

const Header = lazy(() => import('@/component/Header'));
const Footer = lazy(() => import('@/component/Footer'));

export default () => (
  <BasicLayout
    customHeader={
      <Suspense fallback={<div>Loading...</div>}>
        <Header />
      </Suspense>
    }
    footer={
      <Suspense fallback={<div>Loading...</div>}>
        <Footer />
      </Suspense>
    }
  />
);
```

License
-------

Licensed under MIT
