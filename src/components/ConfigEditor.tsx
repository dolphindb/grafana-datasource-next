import React, { useEffect } from 'react';
import { InlineField, Input, SecretInput } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { DataSourceOptions, DataSourceSecureJsonData } from '../types';
import { t } from './i18n';

type Props = DataSourcePluginOptionsEditorProps<DataSourceOptions, DataSourceSecureJsonData>;

function normalizeOptions(options: Props['options']): Props['options'] {
  const defaults = {
    url: '127.0.0.1:8848',
    autologin: true,
    username: 'admin',
    python: false,
    verbose: false,
    poolCapacity: '3',
  };
  const hasLegacyPassword = Object.prototype.hasOwnProperty.call(options.jsonData, 'password');
  if (
    !hasLegacyPassword &&
    (Object.keys(defaults) as Array<keyof typeof defaults>).every((key) => options.jsonData[key] != null)
  ) {
    return options;
  }

  const { password: legacyPassword, ...jsonData } = options.jsonData;
  const secureJsonData = { ...options.secureJsonData };
  if (!options.secureJsonFields?.password && secureJsonData.password === undefined && legacyPassword !== undefined) {
    secureJsonData.password = legacyPassword;
  }

  return {
    ...options,
    jsonData: {
      ...jsonData,
      url: jsonData.url ?? defaults.url,
      autologin: jsonData.autologin ?? defaults.autologin,
      username: jsonData.username ?? defaults.username,
      python: jsonData.python ?? defaults.python,
      verbose: jsonData.verbose ?? defaults.verbose,
      poolCapacity: jsonData.poolCapacity ?? defaults.poolCapacity,
    },
    secureJsonData,
  };
}

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const normalizedOptions = normalizeOptions(options);
  const { jsonData, secureJsonData, secureJsonFields } = normalizedOptions;

  useEffect(() => {
    const updatedOptions = normalizeOptions(options);
    if (updatedOptions !== options) {
      onOptionsChange(updatedOptions);
    }
  }, [options, onOptionsChange]);

  const onChange = (key: 'url' | 'username' | 'poolCapacity') => (event: React.ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...normalizedOptions,
      jsonData: { ...jsonData, [key]: event.currentTarget.value },
    });
  };

  return (
    <div className="gf-form-group">
      <InlineField
        label="URL"
        labelWidth={12}
        tooltip={t('数据库连接地址, 如: 127.0.0.1:8848')}
        htmlFor="config-editor-url"
      >
        <Input id="config-editor-url" value={jsonData.url} onChange={onChange('url')} />
      </InlineField>
      <br />
      <InlineField
        label={t('用户名')}
        labelWidth={12}
        tooltip={t('DolphinDB 登录用户名')}
        htmlFor="config-editor-username"
      >
        <Input id="config-editor-username" value={jsonData.username} onChange={onChange('username')} />
      </InlineField>
      <br />
      <InlineField label={t('密码')} labelWidth={12} tooltip={t('DolphinDB 登录密码')} htmlFor="config-editor-password">
        <SecretInput
          id="config-editor-password"
          value={secureJsonData?.password ?? ''}
          isConfigured={Boolean(secureJsonFields?.password)}
          onChange={(event) =>
            onOptionsChange({
              ...normalizedOptions,
              secureJsonData: { ...secureJsonData, password: event.currentTarget.value },
            })
          }
          onReset={() =>
            onOptionsChange({
              ...normalizedOptions,
              secureJsonFields: { ...secureJsonFields, password: false },
              secureJsonData: { ...secureJsonData, password: '' },
            })
          }
        />
      </InlineField>
      <br />
      <InlineField
        label={t('连接池容量')}
        tooltip={t('该数据源绑定的连接池开启连接的数量')}
        htmlFor="config-editor-pool-capacity"
      >
        <Input id="config-editor-pool-capacity" value={jsonData.poolCapacity} onChange={onChange('poolCapacity')} />
      </InlineField>
    </div>
  );
}
