import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';
import { isWin } from './platform';
import { SCRIPT_DIR } from './hook-status';

export { CTL_INSTANCE_RE } from '../shared/ctl-protocol';

/** Shared parent; each running Vibeyard owns one `<pid>-<hex>` folder inside it. */
export const CTL_COMMANDS_ROOT = path.join(os.homedir(), '.vibeyard', 'commands');
export const CTL_INSTANCE_ID = `${process.pid}-${randomBytes(4).toString('hex')}`;
/**
 * This instance's request folder, passed to its tabs as VIBEYARD_CTL_DIR. The
 * start-error file sits next to it as `<CTL_COMMANDS_DIR>.error`.
 */
export const CTL_COMMANDS_DIR = path.join(CTL_COMMANDS_ROOT, CTL_INSTANCE_ID);
export const CTL_BIN_DIR = path.join(SCRIPT_DIR, 'bin');
export const CTL_COMMAND_PATH = path.join(CTL_BIN_DIR, isWin ? 'vibeyard-ctl.cmd' : 'vibeyard-ctl');
