/**
 * Init command implementation for Craft Audit CLI
 */

import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';

const CONFIG_FILENAME = 'craft-audit.config.json';

const STARTER_CONFIG = {
  $schema:
    'https://raw.githubusercontent.com/forbiddenlink/craft-audit/main/craft-audit.config.schema.json',
  ruleSettings: {},
  securityFileLimit: 2000,
  output: 'console',
  exitThreshold: 'high',
};

export async function executeInitCommand(projectPath: string): Promise<void> {
  const absolutePath = path.resolve(projectPath);
  const configPath = path.join(absolutePath, CONFIG_FILENAME);

  if (fs.existsSync(configPath)) {
    console.log(
      chalk.yellow(`⚠  Config file already exists: ${configPath}\nRemove it first if you want to re-initialize.`)
    );
    return;
  }

  if (!fs.existsSync(absolutePath)) {
    fs.mkdirSync(absolutePath, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(STARTER_CONFIG, null, 2) + '\n', 'utf-8');

  console.log(chalk.green(`✔ Created ${configPath}`));
}
