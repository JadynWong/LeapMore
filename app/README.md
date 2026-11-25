# 从源码构建 LeapMore

LeapMore 使用 React、TypeScript 和 Vite。Android 与 iOS 使用 Capacitor，鸿蒙使用 OpenHarmony Capacitor 适配器。构建会从 `native/` 生成平台工程。直接安装到 iOS 或鸿蒙设备需要配置签名。

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

准备 Xcode 和 iOS SDK，并安装 Ruby 的 `xcodeproj` gem。执行 `pnpm native:ios` 后，用 Xcode 打开 `app/ios/App/App.xcodeproj`。为 App 和桌面卡片扩展选择同一签名团队及可用的 App Group，再编译安装。默认 App Group 为 `group.com.leapmore.app`。个人团队构建时可按自己的签名配置调整 Bundle ID 和 App Group。

### LiveContainer（未签名 IPA）

推送到 fork 的 `ios-livecontainer` 分支会触发 **iOS unsigned IPA** 工作流。构建成功后，在该次 Actions 运行的 **Artifacts** 下载 `LeapMore-iOS-unsigned`，解压后将 `LeapMore-iOS-unsigned.ipa` 导入 LiveContainer。该产物面向 ARM64 真机，而非模拟器，也不能直接安装到 iOS。桌面卡片等依赖系统签名权限的功能不在此安装方式的支持范围内。

导入后可在首页选择连接 Home Assistant，填写具有受信任证书的 HTTPS 地址，并选择「手动输入长期访问令牌」。令牌仅在 App 内填写，不需要写入 GitHub Actions。

## 鸿蒙

准备 DevEco Studio 与支持 API 26 的 HarmonyOS SDK。按 [OpenHarmony Capacitor 适配器](https://gitcode.com/CPF-Ionic/openHarmony-capacitor)的说明准备 [OpenSSL](https://gitcode.com/li_in/openharmony-capacitor-openssl3.5)。如果 SDK 适配器需要 OpenSSL 文件，将 `LEAPMORE_OHOS_OPENSSL_DIR` 设置为其目录。执行 `pnpm native:harmony` 后，在 DevEco Studio 打开生成的 `app/openharmony` 工程，安装模块依赖，配置签名并构建 HAP。

## 构建选项

- 应用版本来自 `app/package.json`。应用检查 GitHub 的 `MiRaToo/LeapMore` 和 GitCode 的 `MiraRato/LeapMore`，查找最新的带 APK 发布版本。自建版本可分别用 `VITE_RELEASE_REPOSITORY` 和 `VITE_GITCODE_RELEASE_REPOSITORY` 指定两个仓库。仓库值格式为 `所有者/仓库名`。
- 用户在 App 中填写自己的零跑、HA 和高德授权。Android 支持用户填写局域网 HTTP HA 地址。自定义构建可用 `LEAPMORE_ANDROID_HA_HTTP_HOST` 将明文连接白名单限定在一个指定的局域网 IPv4 或 `.local` 主机。iOS 可用 `LEAPMORE_IOS_HA_HTTP_HOST` 配置一个明确的 `.local` 主机。
- 发布构建使用默认的关闭 WebView 调试设置。车模由已授权车况接口按需获取，源码仓库只提供查看器代码、通用图标和演示数据。
