import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { ConfigEditor } from './ConfigEditor';
import { DataSourceOptions, DataSourceSecureJsonData } from '../types';

// Markdown is unrelated to the configuration inputs and ships as ESM.
jest.mock('marked', () => ({ marked: { use: jest.fn() } }));
// Exercise the real inputs without loading unrelated calendar/editor modules.
jest.mock('@grafana/ui', () => {
  const root = require('path').dirname(require.resolve('@grafana/ui/package.json'));
  return {
    InlineField: require(`${root}/dist/cjs/components/Forms/InlineField.cjs`).InlineField,
    Input: require(`${root}/dist/cjs/components/Input/Input.cjs`).Input,
    SecretInput: require(`${root}/dist/cjs/components/SecretInput/SecretInput.cjs`).SecretInput,
  };
});
jest.mock('./i18n', () => ({
  t: (key: string) => ({ 用户名: 'Username', 密码: 'Password', 连接池容量: 'Pool capacity' }[key] ?? key),
}));

type Props = DataSourcePluginOptionsEditorProps<DataSourceOptions, DataSourceSecureJsonData>;

function setup(overrides: Partial<Props['options']> = {}) {
  const initialOptions = {
    id: 1,
    uid: 'ddb',
    name: 'DolphinDB',
    type: 'dolphindb-datasource-next',
    access: 'proxy',
    jsonData: {},
    secureJsonFields: {},
    ...overrides,
  } as Props['options'];
  let currentOptions = initialOptions;
  const onOptionsChange = jest.fn();
  function Editor() {
    const [options, setOptions] = useState(initialOptions);
    return (
      <ConfigEditor
        options={options}
        onOptionsChange={(updated) => {
          currentOptions = updated;
          onOptionsChange(updated);
          setOptions(updated);
        }}
      />
    );
  }
  render(<Editor />);
  return { initialOptions, onOptionsChange, getOptions: () => currentOptions };
}

describe('ConfigEditor password storage', () => {
  it('saves new passwords only in secureJsonData without inventing a default password', () => {
    const { getOptions, initialOptions } = setup();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'new-password' } });
    expect(getOptions().secureJsonData?.password).toBe('new-password');
    expect(getOptions().jsonData).not.toHaveProperty('password');
    expect(initialOptions.jsonData).toEqual({});
  });

  it('migrates a legacy password and preserves it when another setting changes', () => {
    const { getOptions, initialOptions } = setup({ jsonData: { password: 'legacy-password', username: 'alice' } });
    expect(getOptions().jsonData).not.toHaveProperty('password');
    expect(getOptions().secureJsonData?.password).toBe('legacy-password');
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'db:8848' } });
    expect(getOptions().jsonData.url).toBe('db:8848');
    expect(getOptions().secureJsonData?.password).toBe('legacy-password');
    expect(initialOptions.jsonData.password).toBe('legacy-password');
  });

  it('keeps a saved password configured when editing other fields and allows reset and replacement', () => {
    const { getOptions } = setup({
      jsonData: { password: 'stale-plaintext' },
      secureJsonFields: { password: true, otherSecret: true },
    });
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByLabelText('Password')).toHaveValue('configured');
    expect(getOptions().secureJsonData).not.toHaveProperty('password');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } });
    expect(getOptions().secureJsonFields.password).toBe(true);
    expect(getOptions().secureJsonData).not.toHaveProperty('password');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Password')).toBeEnabled();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(getOptions().secureJsonFields).toEqual({ password: false, otherSecret: true });
    expect(getOptions().secureJsonData?.password).toBe('');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'replacement' } });
    expect(getOptions().secureJsonData?.password).toBe('replacement');
    expect(getOptions().jsonData).not.toHaveProperty('password');
  });

  it.each(['edited-password', ''])(
    'does not replace a pending secure password %p with the legacy value',
    (password) => {
      const { getOptions } = setup({
        jsonData: { password: 'stale-plaintext' },
        secureJsonData: { password, otherSecret: 'preserve' } as DataSourceSecureJsonData,
      });
      expect(getOptions().secureJsonData?.password).toBe(password);
      expect(getOptions().jsonData).not.toHaveProperty('password');
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'replacement' } });
      expect(getOptions().secureJsonData).toEqual({ password: 'replacement', otherSecret: 'preserve' });
    }
  );
});
