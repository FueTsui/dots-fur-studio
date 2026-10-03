# 第三方声明

Dots · 毛绒实验室是非官方个人项目，与原 Dots 产品及其权利人无隶属、赞助或认可关系。项目名称仅用于说明研究和适配对象。

本仓库暂未指定整体软件许可证。下列许可证仅适用于各自的第三方软件，不表示对整个项目或原 Dots 素材授予同样许可。

## 原 Dots 资源与采样

`public/orbit/` 包含从原 Dots 页面实际加载资源中提取、解码或采样得到的几何、装配数据、缩略图和注视矩阵；`tests/fixtures/gaze-step-response.json` 包含用于动态拟合回归的响应采样。

- 原资源目录：`orbit-character-a46c99f7e8749621/fec1363c5aea4fbb`。
- 原几何 revision：`7f2e673cd9cff752c137d3d858bc4ddb530dda34fe9c2e1fb23a94b2831adf1d`。
- 相关原始素材及其衍生数据的权利由原权利人保留。本项目尚未独立确认这些素材的再分发许可；公开展示不构成向其他使用者授予素材许可。

本项目的毛绒着色器和动态拟合属于适配实现，并非原产品着色器或连续求解器的公开版本。

## Three.js

版本：0.186.1。用途：浏览器端三维渲染及几何处理。上游：[three.js](https://github.com/mrdoob/three.js)。许可证：MIT。原许可证同时保存在 [`third-party/three-LICENSE.txt`](third-party/three-LICENSE.txt)。

```text
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Vite

用途：开发服务器与静态站点构建工具；发布的站点无需运行 Vite。安装版本由 `package-lock.json` 锁定。上游：[Vite](https://github.com/vitejs/vite)。Vite 核心许可证：MIT。

```text
MIT License

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Vite 分发包还包含使用 BSD-2-Clause、CC0-1.0、ISC 和 MIT 等许可证的依赖。完整依赖声明随安装包提供，见 `node_modules/vite/LICENSE.md`；其他开发依赖以各自包内许可证为准。`node_modules/` 不随本项目静态站点包分发。
