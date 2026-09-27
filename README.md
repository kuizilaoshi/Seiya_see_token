# Seiya See Token · Codex 用量托盘小组件

一个 Windows 桌面小工具：在任务栏右下角直接显示 Codex 剩余额度，点击数字打开小面板，查看额度周期、重置时间和本机项目的 Token 用量。

## 下载安装

**普通用户下载安装程序，无需另外安装 Node.js 或 Electron。**

- [下载 Windows x64 安装包 v1.0.2](https://github.com/kuizilaoshi/Seiya_see_token/releases/download/v1.0.2/Seiya-See-Token-Setup-1.0.2-x64.exe)
- [查看全部版本与更新说明](https://github.com/kuizilaoshi/Seiya_see_token/releases)
- [下载 v1.0.2 源码 ZIP](https://github.com/kuizilaoshi/Seiya_see_token/archive/refs/tags/v1.0.2.zip)

适用于 Windows 10/11 x64。运行安装程序，选择安装位置，完成后从桌面或开始菜单打开 **Seiya See Token**。默认安装到当前用户目录。卸载可在 Windows“设置 → 应用 → 已安装的应用”中完成。

安装包内置桌面运行环境，但不包含 Codex、账号登录信息或任何人的用量数据。**读取额度需要本机有可用且已经登录的 Codex CLI。** 首次未读到数据时会显示 `--`，按下面的排错说明检查。

当前安装包未使用商业代码签名证书，Windows 可能提示发布者未验证；请核对下载来源和发布页的 SHA256 校验文件。

## 功能

- **托盘数字：**直接显示当前额度窗口的剩余百分比。
- **小面板：**查看剩余比例、已用比例、窗口长度和重置时间。
- **项目列表：**从本机 Codex 会话日志汇总各项目的 Token 用量。
- **常驻托盘：**点击展开或收起，支持置顶、手动刷新与退出。

剩余额度百分比与项目 Token 数是不同指标。当前读取官方返回的 `codex` 配额的 `primary` 窗口，按实际数据显示周期；目前只展示一个额度窗口，不保证所有账号都是每周额度，也不同时展示所有周期。项目占比来自本地统计，不能换算成“还剩多少 Token”。当前没有自动跟随正在查看的单段对话的功能。

## 日常使用

1. 在 Windows 右下角找到数字图标；被折叠时先点向上箭头。
2. 点击数字打开或收起小面板；面板可拖动，也可置顶。
3. 关闭面板时选择“收进托盘”，数字继续更新；选择“直接退出”结束程序。
4. 点面板刷新按钮，或右键托盘选择“立即刷新”。

额度默认每 60 秒查询一次，本地日志变化会触发项目统计。接口和日志更新存在延迟，不能视作逐 Token 的实时计费器。

安装版使用独立的 `SeiyaSeeToken` 用户设置目录，与旧的源码运行版分开。若同时运行两份，托盘会出现两个图标；按需要退出其中一份。

## Codex 连接与排错

小组件使用当前 Windows 用户的 Codex 登录状态。不会要求把密码或登录文件填进源码。

程序依次检查 `CODEX_CLI_PATH` 环境变量、用户 Codex 配置中的同名路径，以及本机 `OpenAI/Codex/bin` 安装目录。安装位置不同或尚未登录时，可能需要先找到实际的 `codex.exe`。仅能打开 Codex 桌面软件，仍需实际确认命令行工具能被找到。

可以让 Codex 帮忙检查本机工具的位置和登录状态。使用非默认位置时，在启动小组件前设置 `CODEX_CLI_PATH` 为实际路径。例如在同一个 PowerShell 窗口中：

```powershell
$env:CODEX_CLI_PATH = 'C:\实际目录\codex.exe'
& 'C:\实际安装目录\Seiya See Token.exe'
```

| 现象 | 检查方式 |
| --- | --- |
| 显示 `--` | 检查 Codex CLI 路径、登录状态、网络及账号是否返回支持的额度 |
| 显示“暂未更新” | 正在保留最近一次成功结果；查看时间，稍后刷新 |
| 项目列表为空 | 检查当前用户是否有本地 Codex 会话记录，以及当前周期是否有用量 |
| 找不到数字图标 | 查看托盘折叠区，确认程序仍在运行 |
| 周期与预期不同 | 核对同一账号、同一周期；当前只读取 primary 窗口 |

账号接口或日志格式变化后，可能需要更新程序。问题反馈请附 Windows 版本、操作步骤与错误现象，遮住账号、私人项目名称和密钥。

## 从源码运行和修改

需要 Node.js 22.12 或更高版本及 npm。下载源码、解压后在项目目录执行：

```powershell
npm.cmd ci
npm.cmd start
```

首次安装需要联网下载依赖。主要界面在 `src/index.html`，样式在 `src/styles.css`，显示逻辑在 `src/renderer.js`，托盘与窗口行为在 `src/main.js`。

```powershell
npm.cmd test
npm.cmd run dist
```

`dist` 命令生成 Windows x64 安装包，输出到 `dist/`。源码版也可运行 `npm.cmd run create-shortcut` 创建快捷方式；“同时打开 Codex”的入口依赖本机桌面 `Codex.lnk`。

## 数据与隐私

额度通过本机 Codex CLI 的 `account/rateLimits/read` 查询，可能需要联网并使用已有登录状态。项目统计读取当前用户 `.codex/sessions` 日志；本项目没有将会话日志上传到自建服务器的逻辑。

窗口偏好保存在当前用户应用数据目录。安装包与源码不包含作者登录文件、会话记录或个人用量。请勿公开自己的 `.codex`、`auth.json`、日志、密钥和真实用量截图。

## 开源许可与参与

本项目代码、说明和作者提供的外观素材采用 [MIT 许可证](LICENSE)，允许免费使用、修改、分发和商用，再发布时保留版权声明和许可证。Electron 等第三方依赖适用各自的许可，安装包保留对应许可文件。

欢迎通过 [Issues](https://github.com/kuizilaoshi/Seiya_see_token/issues) 反馈问题，或通过 Fork 与 Pull Request 提交改进。

这是 Seiya 的个人开源工具，与 OpenAI 官方产品无隶属关系。软件按现状提供，实际额度能力取决于账号及 Codex 接口。
