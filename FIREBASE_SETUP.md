# Firebase 対戦機能の設定

Firebase コンソールで、Authentication の匿名ログインを有効にします。

次に Realtime Database の **ルール** タブへ移動し、以下を貼り付けて公開します。

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

このルールでは、匿名ログイン済みのプレイヤーだけが対戦ルームを読み書きできます。ルームコードは画面で発行され、同じコードを入力した最大4人で対戦します。
