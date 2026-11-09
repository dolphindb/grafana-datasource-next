import { test, expect } from '@grafana/plugin-e2e';
import { MyDataSourceOptions, MySecureJsonData } from '../src/types';

test('"Save & test" encrypts the password when configuration is valid', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  page,
}) => {
  const password = process.env.DOLPHINDB_PASSWORD;
  test.skip(password === undefined, 'Set DOLPHINDB_PASSWORD and start DolphinDB to run the connection test');
  const ds = await readProvisionedDataSource<MyDataSourceOptions, MySecureJsonData>({ fileName: 'datasources.yml' });
  const configPage = await createDataSourceConfigPage({ type: ds.type });
  await page.getByLabel('URL', { exact: true }).fill(ds.jsonData.url ?? '127.0.0.1:8848');
  await page.getByLabel('Username', { exact: true }).fill(ds.jsonData.username ?? 'admin');
  await page.getByLabel('Password', { exact: true }).fill(password ?? '');
  await expect(configPage.saveAndTest()).toBeOK();
  await page.reload();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('configured');
  await expect(page.getByLabel('Password', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toBeEditable();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

test('"Save & test" should fail when the database address is invalid', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource<MyDataSourceOptions, MySecureJsonData>({ fileName: 'datasources.yml' });
  const configPage = await createDataSourceConfigPage({ type: ds.type });
  await page.getByLabel('URL', { exact: true }).fill('127.0.0.1:0');
  await page.getByLabel('Password', { exact: true }).fill('invalid-password');
  await expect(configPage.saveAndTest()).not.toBeOK();
  await expect(configPage).toHaveAlert('error', { hasText: 'Database connect/test error' });
});
