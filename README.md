# Personal Expenses

手机友好的个人花费记录 APP。数据使用 Google Sheet，读写方式与 Account Record APP 相同：Google Apps Script Web App + Netlify。

## Google Apps Script

1. 打开个人花费 Google Sheet。
2. 进入「扩展功能」→「Apps Script」。
3. 把 `apps-script.gs` 的内容复制进去并保存。
4. 点击「部署」→「新增部署作业」。
5. 类型选择「网页应用程序」。
6. 执行身份选择「我」，谁可以访问选择「任何人」。
7. 部署并复制 Web App URL。
8. 将 URL 填入 `app.js` 的 `APPS_SCRIPT_URL`，再上传 APP 文件。

Google Sheet 主工作表的栏位顺序必须是：`Date`、`Topic`、`Others`、`Cost`。
「选项」工作表中的内容会自动作为 Topic 选项。

## 手机发布

可将 `index.html`、`styles.css`、`app.js`、`manifest.webmanifest` 上传到 Netlify Drop，取得网址后即可在电话打开，并选择「加入主画面」。
