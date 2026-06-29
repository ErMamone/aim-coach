/* eslint-disable @typescript-eslint/no-var-requires */
const config = require('./webpack.base.config');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

const rendererConfig = { ...config };
rendererConfig.target = 'electron-renderer';
rendererConfig.entry = {
  'preload': './src/preload/preload.ts'
};

rendererConfig.plugins.push(new HtmlWebpackPlugin({
  template: './src/renderer/overlay/overlay.html',
  filename: path.join(__dirname, './dist/renderer/overlay.html'),
  inject: false
}));

module.exports = rendererConfig;
