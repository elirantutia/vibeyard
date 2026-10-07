import * as path from 'path';
import * as os from 'os';
import { isWin } from './platform';
import { SCRIPT_DIR } from './hook-status';

export const CTL_COMMANDS_DIR = path.join(os.homedir(), '.vibeyard', 'commands');
export const CTL_BIN_DIR = path.join(SCRIPT_DIR, 'bin');
export const CTL_COMMAND_PATH = path.join(CTL_BIN_DIR, isWin ? 'vibeyard-ctl.cmd' : 'vibeyard-ctl');
/** Written by the main process when the command server fails to start; read by the client. */
export const CTL_START_ERROR_PATH = path.join(CTL_BIN_DIR, 'ctl-start-error');
