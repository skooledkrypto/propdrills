// Shares the framework-agnostic domain core (../src/core) with the web app.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '..', 'src', 'core')];

module.exports = config;
