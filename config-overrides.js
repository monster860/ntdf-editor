const webpack = require('webpack');

module.exports = function override (config, env) {
	let loaders = config.resolve;
	loaders.fallback = {
		"assert": require.resolve("assert/"),
		"zlib": require.resolve("browserify-zlib/"),
		"stream": require.resolve("stream-browserify/"),
		"buffer": require.resolve("buffer/"),

	};

	config.plugins.splice(0, 0, new webpack.ProvidePlugin({
		Buffer: ['buffer', 'Buffer']
	}), new webpack.ProvidePlugin({
		process: 'process/browser'
	}));
	
	return config;
}