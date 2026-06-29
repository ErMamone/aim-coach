/* eslint-disable @typescript-eslint/no-var-requires */
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
          globOptions: { ignore: ['**/*.html'] },
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
