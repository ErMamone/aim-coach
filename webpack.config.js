const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'development',
  devtool: 'inline-source-map',
  entry: {
    background: './src/background/background.ts',
    'in-game': './src/overlay/overlay.ts',
    config: './src/config/config.ts',
  },
  module: {
    rules: [
      { test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  output: {
    path: path.resolve(__dirname, 'dist/'),
    clean: true,
    filename: 'windows/[name]/controller.js',
  },
  plugins: [
    // Copia manifest.json + assets/ (todo public salvo los .html, que los maneja HtmlWebpackPlugin)
    new CopyPlugin({
      patterns: [
        {
          context: path.resolve(__dirname, 'public/'),
          from: './',
          to: './',
          // .html los maneja HtmlWebpackPlugin; .md/notas y el MASTER del logo (fuente, ya se derivan
          // icon.png/icon_gray.png/desktop_icon.ico via 'yarn icons') no van al build -> OPK limpio.
          globOptions: { ignore: ['**/*.html', '**/*.md', '**/*.markdown', '**/*.txt', '**/aim-coach-logo.png'] },
        },
        // Capturer C# bundleado en el paquete -> el background lo extrae a appData y lo auto-lanza.
        // noErrorOnMissing: en dev sin `yarn build:native` el build no falla (se corre el .exe a mano).
        {
          from: path.resolve(__dirname, 'native/publish/AimCoach-MouseCapturer.exe'),
          to: path.resolve(__dirname, 'dist/native/AimCoach-MouseCapturer.exe'),
          noErrorOnMissing: true,
        },
      ],
    }),
    new HtmlWebpackPlugin({
      template: './public/windows/background.html',
      filename: path.resolve(__dirname, './dist/windows/background/page.html'),
      chunks: ['background'],
    }),
    new HtmlWebpackPlugin({
      template: './public/windows/in-game.html',
      filename: path.resolve(__dirname, './dist/windows/in-game/page.html'),
      chunks: ['in-game'],
    }),
    new HtmlWebpackPlugin({
      template: './public/windows/config.html',
      filename: path.resolve(__dirname, './dist/windows/config/page.html'),
      chunks: ['config'],
    }),
  ],
};
