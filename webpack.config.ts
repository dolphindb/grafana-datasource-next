import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';

import grafanaConfig from './.config/webpack/webpack.config';

interface BuildEnvironment {
  production?: boolean;
  development?: boolean;
  reactDetect?: boolean;
}

const config = async (env: BuildEnvironment): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  const config = merge(baseConfig, {
    // Grafana owns React at runtime. In particular, a React 18 jsx-runtime
    // bundled into a plugin is incompatible with Grafana 13's React 19.
    externals: ['react/jsx-runtime', 'react/jsx-dev-runtime'],
  });

  // @grafana/react-detect reads production source maps. Keep them opt-in so
  // normal release builds retain the project's existing output layout.
  if (env.reactDetect) {
    config.devtool = 'source-map';
  }

  return config;
};

export default config;
