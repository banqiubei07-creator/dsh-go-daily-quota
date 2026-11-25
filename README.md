# 今日额度（local-daily-quota）

dsh-go 手机 App 的本地小插件：在输入框上方常驻一条状态，显示**今日花费**、**账户余额**和当前是**峰时还是谷时**。

## 显示效果

```
今日¥0.97·余额¥1.57 谷时
```

- **今日**：以当天第一次读到的余额为基准，之后的差额就是今天花掉的钱（充值不会算成负数）
- **余额**：DeepSeek 账户当前余额（人民币）
- **峰时 / 谷时**：按 DeepSeek 官方峰谷定价判断。北京时间周一至周五 9:00–12:00、14:00–18:00 为峰时（橙色警示），其余时间含周末全天为谷时半价（绿色）。法定节假日暂未单独判断
- 点一下这条状态，会弹出余额、今日花费和当前时段说明
- 余额每 5 分钟刷新一次，峰谷每分钟按北京时间重算

## 安装

1. 把整个目录放到主机的 `$DSH_HOME/dsh-go/plugins/` 下（`DSH_HOME` 默认 `~/.dsh`），目录名建议 `local-daily-quota`
2. 安装：

   ```sh
   dsh plugin --profile web add "$DSH_HOME/dsh-go/plugins/local-daily-quota"
   ```

3. 在 App 的「设置 → 引擎 → 重启引擎」重启一次，输入框上方就会出现状态条

代码改动后需要重启引擎；只改 `package.json` 清单会自动重读。

## 数据来源

读取 `$DSH_HOME/.credentials.yaml` 里的 `DEEPSEEK_API_KEY`，请求 `https://api.deepseek.com/user/balance`。密钥只在本机使用，不会写进视图或日志。

每天的花费基准存在插件目录的 `data/state.json`，删掉它只会重置当天基准，不影响余额读取。

## 卸载

```sh
dsh plugin --profile web remove local-daily-quota
```

再删除插件目录。
