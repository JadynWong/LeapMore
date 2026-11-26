# 从源码构建 LeapMore

LeapMore 使用 React、TypeScript 和 Vite。Android 与 iOS 使用 Capacitor，鸿蒙使用 OpenHarmony Capacitor 适配器。构建会从 `native/` 生成平台工程。

## 安装依赖和本地预览

准备 Node.js 22.12 或以上版本和 pnpm 11。从仓库根目录执行：

```sh
cd app
pnpm install --frozen-lockfile
pnpm test
pnpm dev --port 5175
```

浏览器访问 `http://127.0.0.1:5175`，可用演示账号查看车况和记录。执行 `pnpm build` 可生成 Web 构建产物。安装版 App 才能使用设备安全存储、生物识别、桌面卡片等原生功能。

## Android

准备 JDK 21 和 Android SDK 36，并设置 `JAVA_HOME` 和 `ANDROID_HOME`。在 `app/` 执行：

```sh
pnpm native:android
cd android
./gradlew :app:assembleDebug
```

调试 APK 位于 `app/android/app/build/outputs/apk/debug/app-debug.apk`。如需分发自己的构建，执行 `./gradlew :app:assembleRelease`，对齐 APK 后用自己的密钥签名。

## iOS

准备 Xcode 26 或以上版本、iOS 26 或以上 SDK，并安装 Ruby 的 `xcodeproj` gem。执行 `pnpm native:ios` 后，用 Xcode 打开 `app/ios/App/App.xcodeproj`。为 App 和桌面卡片扩展选择同一签名团队及可用的 App Group，再编译安装。默认 App Group 为 `group.com.leapmore.app`。个人团队构建时可按自己的签名配置调整 Bundle ID 和 App Group。

执行 `pnpm package:ios` 生成一个真机侧载包 `ios/build/LeapMore-v<版本>-ios.ipa`。该文件带有临时签名，保留主应用与桌面小组件共享车况所需的 App Group。GitHub Actions 的「iOS IPA」工作流在版本标签或手动运行时提供同一份产物。

使用 SideStore 导入 IPA 时选择「Keep App Extensions」，让主应用和小组件一起重签。安装后打开 LeapMore 同步一次车况，再添加小组件。使用 LiveContainer 可导入同一文件运行主应用，容器内的小组件无法注册到系统桌面。[LiveContainer 官方说明](https://github.com/LiveContainer/livecontainer.github.io/blob/main/docs/faq.md)

## 鸿蒙

准备 DevEco Studio、支持 API 26 的 HarmonyOS SDK 和 [OpenSSL 3.5.4 官方源码包](https://github.com/openssl/openssl/releases/tag/openssl-3.5.4)。在 `app/` 执行以下命令生成 arm64 与 x86_64 两种架构的库；脚本会先校验源码包的 SHA-256。库输出目录须为新目录，已有构建可复用。

```sh
sh scripts/build-harmony-openssl.sh /path/to/openssl-3.5.4.tar.gz /path/to/ohos-openssl
LEAPMORE_OHOS_OPENSSL_DIR=/path/to/ohos-openssl pnpm native:harmony
```

在 DevEco Studio 打开生成的 `app/openharmony` 工程，安装模块依赖，以 release 模式构建 HAP。分发前从 `app/` 执行 `node scripts/harmony-release-paths.mjs /path/to/release.hap`，检查安装包是否带有构建机的个人目录路径。

## 构建选项

- 应用版本来自 `app/package.json`。应用检查 GitHub 的 `MiRaToo/LeapMore` 和 GitCode 的 `MiraRato/LeapMore`，按当前系统查找带 APK、IPA 或 HAP 的最新版本。自建版本可分别用 `VITE_RELEASE_REPOSITORY` 和 `VITE_GITCODE_RELEASE_REPOSITORY` 指定两个仓库。仓库值格式为 `所有者/仓库名`。
- 用户在 App 中填写自己的零跑、HA 和高德授权。Android 支持用户填写局域网 HTTP HA 地址。自定义构建可用 `LEAPMORE_ANDROID_HA_HTTP_HOST` 将明文连接白名单限定在一个指定的局域网 IPv4 或 `.local` 主机。iOS 可用 `LEAPMORE_IOS_HA_HTTP_HOST` 配置一个明确的 `.local` 主机。
- 发布构建使用默认的关闭 WebView 调试设置。车模由已授权车况接口按需获取，源码仓库只提供查看器代码、通用图标和演示数据。
