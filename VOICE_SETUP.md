# ボイスチャットの設定

## 構成

- LiveKit Cloud：マイク音声の配信。音声のみを使用します。
- Cloudflare Workers：Firebaseのログインと対戦参加者を確認し、短時間だけ有効な通話トークンを発行します。
- GitHub Pages：既存のゲーム画面。秘密キーは置きません。

通話への参加は任意です。待機中に「通話に参加」を押してマイクを許可します。ゲーム中は接続を切り、参加していた人は結果画面で再接続します。手動ミュートの状態は維持します。設定画面へ戻る、対戦を退出する、通話から退出する場合は切断します。ブラウザの自動再生制限などで再接続に失敗した場合は、結果画面で再度「通話に参加」を押してください。

## 1. LiveKit Cloud

https://cloud.livekit.io/ でアカウントとプロジェクトを作成します。プロジェクトのWebSocket URL（`wss://...livekit.cloud`）、API Key、API Secretを控えます。AIエージェントや電話の設定は不要です。

API Secretをチャット、GitHub、公開JavaScriptに貼り付けないでください。

## 2. Cloudflare Workers

https://dash.cloudflare.com/ でアカウントを作成し、Workers & PagesからWorkerを作成します。最小のJavaScript Workerを選び、編集画面のコードを `voice-worker/worker.js` の内容で置き換えます。ビルドや外部パッケージは不要です。

Workerの設定の「Variables and Secrets」に次を登録します。API Secretは必ずSecretとして登録します。

| 設定名 | 値 |
| --- | --- |
| `LIVEKIT_URL` | LiveKitプロジェクトの `wss://...` URL |
| `LIVEKIT_API_KEY` | LiveKitのAPI Key（Secretとして登録推奨） |
| `LIVEKIT_API_SECRET` | LiveKitのAPI Secret（Secretとして登録） |
| `FIREBASE_API_KEY` | 既存の `firebase-config.js` の `apiKey` |
| `FIREBASE_DATABASE_URL` | `https://sedm-karuta-default-rtdb.firebaseio.com` |
| `ALLOWED_ORIGIN` | `https://vectorpattern.github.io`（末尾のスラッシュや `/sedm_karuta` は不要） |

保存・デプロイ後、Workerの公開URL（`https://...workers.dev`）を控えます。URLをブラウザで直接開くと403になるのは仕様です。ゲーム画面からの認証付きPOSTだけを許可します。

## 3. ゲームに接続先を設定

`voice-config.js` の `tokenEndpoint` にWorkerの公開URLを設定し、ゲーム側の変更をGitHubへアップロードします。Worker本体はCloudflare側へ別途デプロイする必要があります。

接続先が空の間は「設定準備中」と表示し、マイクは使用しません。Firebaseルールは既存のルーム用ルールを利用します。

## 4. 動作確認

1. 別端末か通常ウィンドウとシークレットウィンドウで、新しい対戦ルームに2人入ります。
2. 両方で「通話に参加」を押し、マイクを許可します。イヤホンを推奨します。
3. 会話とミュート切り替えを確認します。
4. 対戦開始後、通話が切断され、読み上げだけが聞こえることを確認します。
5. 最後まで対戦し、結果画面で通話が再接続されることを確認します。
6. 通話退出・対戦退出・設定画面へ戻った際にマイクが停止することを確認します。
7. マイクを拒否した場合も、ゲーム自体は進められることを確認します。

公開HTTPSサイトで試してください。通信料金の無料枠は各サービスの管理画面で確認してください。

## 制約

通話時刻の制御はゲーム画面で行います。悪意ある改造クライアントの既存通話をゲーム開始時にサーバーから強制排除する機能は含みません。参加許可の強度は、既存のFirebaseルームの書き込みルールにも依存します。

## 処理テスト

Web APIを備えたNode.js 22以降で `node --test voice-worker/worker.test.mjs` を実行します。実際のサービス設定・マイク通信は別途2端末で確認が必要です。

公式資料：
- https://docs.livekit.io/frontends/reference/tokens-grants/
- https://docs.livekit.io/reference/client-sdk-js/
- https://firebase.google.com/docs/reference/rest/auth#section-get-account-info
