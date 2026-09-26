# 楽譜PDF補正

スキャンした楽譜PDFを補正して A4 縦の PDF に書き出す、ブラウザだけで動く自分用ツール。
ファイルはどこにも送信されない(処理はすべてブラウザ内)。

公開URL: https://secidoire.github.io/music_sheet_tools/

## 機能

- PDF をドラッグ&ドロップ(または「PDFを開く」)で読み込み
- 見開きの左右分割: 中央 ±10% の範囲で白い綴じ代(なければ綴じ目の影)を検出。分割線はドラッグ/矢印キーで調整、ページごとに分割 ON/OFF
- 傾き補正: 五線の水平線から射影プロファイル法で角度を検出(±5°)。左右ページ別に手動微調整可(緑のガイド線が五線と平行になるよう合わせる)
- 背景の白飛ばし: レベル補正(階調保持)/適応的二値化、強度調整
- 余白の自動トリミング → A4 縦に余白を揃えて配置(小さいページを過度に拡大しない)
- ページごとの処理前/後プレビュー、「補正を取り消す(原本のまま)」「自動検出に戻す」
- A4 PDF 書き出し(600/400/300dpi、可逆圧縮のグレースケール。二値化モードは 1bit)

## 構成

| 場所 | 役割 |
| --- | --- |
| `src/pipeline/` | 画像処理パイプライン(分割・傾き検出・白飛ばし・トリミング・A4配置)。UI 非依存で、ブラウザの Worker と Node の検証スクリプトで共用 |
| `src/worker/` | 処理用 Web Worker(OpenCV.js、pdf-lib による PDF 組み立て) |
| `src/lib/` | pdf.js によるラスタライズ(メインスレッド、タイル分割)、状態管理 |
| `src/components/` | UI |
| `scripts/` | UI なしの検証スクリプト |

OpenCV.js と pdf.js の wasm/cmaps は `npm run vendor`(dev/build 前に自動実行)で `public/vendor/` にコピーされ、
`vite.config.ts` の `base`(`/music_sheet_tools/`)配下から読み込まれる。

## 開発

```sh
npm ci
npm run dev          # http://localhost:5173/music_sheet_tools/
npm run build
```

### パイプラインの検証(UI なし)

`samples/` に PDF を置く(著作物を含むため `.gitignore` で除外済み)。

```sh
# 検出結果を画像に描画して debug-out/pipeline/ に出力(分割線=赤、Hough線分=緑、角度)
npm run debug:pipeline -- --filter フェスティバル --pages 2
# 1 ファイルを丸ごと処理して A4 PDF を debug-out/ に出力
npm run debug:export -- フェスティバルTp 600
# 傾きの独立測定(検出値の確認用)
npx tsx scripts/verify-skew.ts フェスティバル.pdf 1 0.06 0.42 4
```

## デプロイ

`main` への push で GitHub Actions(`.github/workflows/deploy.yml`)がビルドして GitHub Pages に公開する。
