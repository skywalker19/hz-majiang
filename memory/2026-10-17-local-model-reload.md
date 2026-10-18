# DEBUG REPORT — 手机模型下载完成后回主页

- **Symptom:** 用户报告 iPhone 13 在“下载模型 100%”后回到主页面，重新打开语音助手再次显示下载。
- **Evidence:** 本地代码没有模型完成后刷新页面或关闭抽屉的路径。Transformers.js 的 progress 回调也用于缓存读取，旧文案因此会将缓存读取显示成下载。此前模型读取、缓存写入和初始化在同一个 pipeline 内完成；WebGPU 失败后立即再尝试 WASM，异常后重新开抽屉会自动重试。
- **Root cause hypothesis:** 下载后的缓冲区、缓存写入和推理资源分配造成手机内存压力，使页面被浏览器重载。尚未取得该手机的崩溃日志或在同型号设备复现，不能把这个推测当作已确认原因。
- **Fix:** 新增 model-cache.js，将必要文件以流式方式写入 Cache Storage 并确认保存后再启动推理。将网络下载、保存、缓存读取及初始化的提示区分。通过 localStorage 标记未完成的初始化，页面重载或初始化失败后停止自动重试，提供显式重试按钮。不在 WebGPU 失败后自动创建 WASM 实例；WASM 使用单线程。模型准备期间不启动收音。
- **Regression tests:** v3/tests/model-cache.test.js 覆盖缓存提交、跨次复用、截断流、配额不足、HTML 回退及存储不可用。v3/tests/local-corrector.test.js 覆盖缓存进度、同页面复用、初始化中断后的恢复标记、错误重试及 GPU/WASM 互斥。
- **Verification:** npm test --prefix v3：109/109 通过。真实 Codex 内置浏览器以 64 KB 假文件验证原生 Cache Storage：首次总请求 1，重复准备仍为 1；刷新页面后模型文件请求数为 0，缓存内容长度 65536。没有下载完整权重，也没有执行 iPhone 13 上的完整推理。
- **Related:** 此前已将模型来源切为同源目录；此次保持模型 URL 与缓存命名不变，可复用已完整保存的文件。
- **Status:** DONE_WITH_CONCERNS。缓存与重试流程已验证；iPhone 13 初始化期间是否仍被系统重载，需要更新网页后的设备结果确认。

## 补充：iPhone 13 / Safari / iOS 26+ 的 Internal error

- 用户随后报告下载到 100% 后显示“本地纠错模型未能启动 internal error”，并确认 iOS 26 或更新。
- 该通用提示覆盖 prepareLocalModelFiles、运行库导入及 pipeline 初始化；不能根据旧提示将错误定位到 ONNX，也不能直接认定为内存不足。
- 上游 Transformers.js 4.3 release 已支持 Safari 26 WebGPU：https://github.com/huggingface/transformers.js/releases/tag/4.3.0 。仍需检查实际 adapter 与 shader-f16。
- 上游 4.3 onnx.js 中 webInitChain 通过 rejectedPromise.then(load) 串行初始化，一次失败后同上下文再次创建 pipeline 不能重置它：https://raw.githubusercontent.com/huggingface/transformers.js/4.3.0/packages/transformers/src/backends/onnx.js 。改为明确提示用户刷新后手动重试；不在同一失败运行环境反复创建实例。
- 增加下载前 adapter/FP16 检查、按阶段显示错误及展开诊断信息（build 2026-10-17.4）；缓存写入的 UnknownError/Internal error 保留原始名称和 saving 阶段。
- 回归用例模拟相同 Internal error 分别发生在 cache.put 和 pipeline，断言错误阶段不同，缓存保存失败时未导入推理组件。
- 本次验证：npm test --prefix v3：113/113 通过（含 adapter 不可用、FP16 缺失、保存错误和推理错误的分阶段上报，以及失败运行环境要求刷新）。重新生成了 dist/index.html 和发布压缩包。
- 尚未获得实际手机的分阶段错误详情，底层原因仍待确认；不将本次诊断和错误恢复改动宣称为已修复 Safari 上的模型兼容性。

## 补充：更新 .4 后用户报告“模型保存失败 Internal error”

- **Symptom:** 用户替换诊断网页后，明确报告“模型保存失败 internal error”；尚未提供失败文件名。旧保存代码把 cache.put 内的网络流读取错误也归为 saving，因此该阶段仍不足以断言一定是磁盘或内存故障。
- **Source evidence:** WebKit 当前 DOMCache.cpp 的 put 实现用 SharedBufferBuilder 收集所有响应块，并调用 takeBufferAsContiguous 后再提交。此前“传入流即可避免完整缓冲区”的假设不成立：https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/cache/DOMCache.cpp 。用户模型权重为 569789750 字节。该实现是已确认的内存压力来源；是否正是此手机 Internal error 的底层原因仍未实机确认。
- **Fix:** .5 优先使用 OPFS createWritable 逐块写入并原子关闭；下载前用一字节文件检查可写性，保存后核对文件大小。Transformers.js 使用 useCustomCache/customCache 读取同一文件存储，不再另向 Cache Storage 写入大模型。旧完整缓存继续复用；无 writable API 时保留原缓存后端。Safari 26 支持 writable stream 的上游记录：https://bugs.webkit.org/show_bug.cgi?id=231706 。
- **Error reporting:** 下载流错误保留 downloading 阶段；写入错误为 saving。提示直接带文件名和后端，展开诊断含 storageBackend。
- **Validation/status:** 本轮未新增或运行测试；仅生成静态发布文件。没有在用户 iPhone 上执行完整权重保存或推理。状态 DONE_WITH_CONCERNS，需部署 .5 后观察手机结果，不能宣称故障已在真机消除。已有 113 项测试记录属于上一轮 .4，不能作为 .5 验证结果。

## 补充：.5 真机截图及重试后整个网页重载

- 用户截图 IMG_7883 确认 build 2026-10-17.5、stage interrupted、device null、modelCached null、gpuApi true；这些 null 属于重载后的新页面，不能据此判断 GPU 失败或缓存丢失。截图 UA 的 Safari Version 为 26.1。
- 用户随后明确：点击重试，显示初始化模型，然后整个网页重新加载。按代码，若该提示对应“初始化纠错模型”，已完成文件保存检查并进入 pipeline；代码无模型报错后自动刷新/关闭抽屉的分支，刷新按钮只在用户点击且已有运行时错误时调用 reload。尚无 Safari 系统日志，不能确认内存、GPU 驱动或其他运行时故障。
- 已确认的诊断缺陷：原初始化标记仅为字符串 initializing，重载后所有先前设备、缓存、文件、运行库信息丢失。继续同样重试无法获得新证据。
- .6 诊断改动：运行库和 pipeline 加载期间，阶段、文件或运行库进度类别变化时保存精简诊断快照；下次页面发现标记时放入 previousAttempt 并自动展开详情。排除 previousAttempt 避免递归增长；成功或被捕获异常后仍清除标记。兼容旧字符串，无法还原 .5 已丢失的记录。未改模型、缓存版本或运行后端。
- 本轮未新增或运行测试，仅生成发布文件；未复现实际 iPhone 进程重载。状态 DONE_WITH_CONCERNS：诊断信息保留已实现，初始化重载的底层问题未解决。下一步需要 .6 的 previousAttempt 或 Safari 系统日志，再决定模型/运行时调整；避免继续凭泛化错误盲改。

## 用户提供 .6 的 previousAttempt 后更改需求：仅保留播报

- 真机记录：stage initializing，device webgpu，shaderF16 true，modelCached true，storageBackend opfs，file onnx/model_q4f16.onnx，runtimeStatus done。存储 usage 578933906，quota 41231686042；GPU maxBufferSize 和 maxStorageBufferBindingSize 均为 715827880。运行库 Transformers.js 4.3.0 / ORT Web 1.31.0-dev。说明已完成文件保存与权重读取，不能把故障再归因到下载失败、无 WebGPU、无 FP16 或磁盘配额；仍无法单凭快照确认系统杀进程的原因。
- 上游发现相似 Safari 26.x Asyncify/WASM 编译内存激增导致页面重载的报告，包括 26.6.x；与本机现象一致但未证明同因：https://bugs.webkit.org/show_bug.cgi?id=304810 ，https://github.com/microsoft/onnxruntime/issues/26827#issuecomment-5503436676 。
- 用户先选择自有服务器纠错，随后明确取消：“算了 不用语音输入了 只要求语音播报吧”。停止后端迁移，删除本轮刚新增且未接入的 server/corrector.py 与 js/server-corrector.js。未改动原服务器运行程序或部署配置。
- 新版 2026-10-17.8-speech：发布网页移除录音、识别、纠错、模型与运行库加载、接口健康检查。系统 SpeechSynthesis 独立输出，确认结算后自动播报；支持开关、分数/庄家/起牌位置朗读、试听、重听、停止。不支持合成时保留文字。旧模型源码与服务保留作资料，不进入发布包；不清理用户的浏览器模型缓存或服务器模型。
- 牌局存储和计分规则沿用，包括三老 ×16。仅需部署 dist/index.html，无需新增或重启后端。本轮未新增或运行测试，仅构建发布；实际 iPhone 声音效果未确认。
