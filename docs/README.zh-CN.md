# mp32json

[English](../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh-CN.md)

一个无 JavaScript 依赖的 Node.js CLI，使用 `ffmpeg` 将音频转换为适用于 Web 可视化与音频响应界面的 compact JSON。

## 功能与限制

可分析单个文件或递归批处理文件夹，支持 `ffmpeg` 能解码的 AAC、AIFF、FLAC、M4A、MP3、OGG、Opus、WAV 和 WebM。以 0～255 输出 `rms`、`low`、`mid`、`high`、`flux`、`beat`、`bloom`，格式可选 compact 或 readable JSON。

工具使用简单 one-pole filter、逐曲归一化和启发式节拍检测，并非音乐信息检索或母带处理工具，节拍结果仅为近似值。

## 要求与运行

需要 Node.js 20+ 及 PATH 中可用的 `ffmpeg`。package 标记为 `private`，没有 npm 发布包或可执行文件发行版。由于没有 JS 依赖，无需运行 `npm install`。

```bash
node src/analyze-audio.js --help
node src/analyze-audio.js "song.mp3" --album-id my-song --output result/my-song.profile.json
npm run batch
```

批处理默认递归读取 `source/` 并写入 `result/`。可用参数：`--fps`（默认 30）、`--format compact|readable`、`--output`、`--source-dir`、`--result-dir`。单文件模式省略输出路径时写到 stdout。二进制 `.u8` 尚未实现。同名 slug 会使批处理结果被覆盖，请使用不同的基础文件名。

## 使用输出

`frames` 中的值是 0～255 整数。用 `Math.floor(currentTime * profile.fps)` 选择 frame，再除以 255 得到 0～1。输出字段包括 `version`、`albumId`、`fps`、`duration`、`channels`、`frames`、`beats`。

## 隐私、版权与资源限制

分析完全在本地进行，不上传音频。`source/` 与 `result/` 中的实际文件会被 gitignore，但仍由用户负责管理。只处理您拥有或获准处理的音频，勿擅自提交或分发原始录音。生成数据不会消除源音频的版权或许可证限制。解码音频和 frame 会保存在内存中，ffmpeg 输出 buffer 上限为 512 MiB，因此长音频可能占用大量内存。

## 状态与验证

这是早期 `0.1.0` 工具，没有自动化测试套件。先以 `--help` 检查 CLI，再用您有权使用的小型音频进行实际验证。

![JSON 结果示例](demo-screenshots/song-analyzer-flow-01-json-result.png)

## 许可证与署名请求

仓库没有独立许可证文件。请勿因源码公开就假定可以复制、修改或再分发，应先确认所需权利。如介绍本项目或在获授权的衍生项目中使用，欢迎注明 `@Bum-Boo` 和[原始仓库](https://github.com/Bum-Boo/mp32json)。这只是礼貌请求，不增加或取代任何许可证义务。
