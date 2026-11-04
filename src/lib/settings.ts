import type { GoalHistory } from './scoring';
import type { Mode } from './session';
import { DEFAULT_INTERVALS } from './srs';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  roundSize: number;
  dailyGoal: number;
  /** earlier daily goals, so a goal change doesn't rewrite past streak days (set when the goal changes) */
  goalHistory?: GoalHistory;
  mode: Mode;
  showHint: boolean;
  autoplay: boolean;
  rate: number;
  voice: string;
  intervals: number[];
  theme: Theme;
  /** download a level's recording bundle when you start playing it */
  autoSaveRecordings: boolean;
  /** the level you chose last; Home and Play continue from here */
  currentLevel?: number;
  /** Choose/Type: the speaker button works before answering (hearing the sentence gives the word away) */
  audioBeforeAnswer: boolean;
  /** Type/Listen: the box turns green/red while typing, depending on whether it matches so far */
  typingColor: boolean;
  /** Type/Listen: the box is as wide as the missing word (off: same size for every word) */
  fitBox: boolean;
  /** Type/Listen: ä, ö, ü, ß must be typed (ae, oe, ue, ss are not accepted) */
  strictUmlauts: boolean;
  /** Type/Listen: one more try when the answer is one letter off or misses umlaut dots */
  secondTry: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  roundSize: 10,
  dailyGoal: 200,
  mode: 'mc',
  showHint: true,
  autoplay: true,
  rate: 1,
  voice: 'de_DE-thorsten-medium',
  intervals: [...DEFAULT_INTERVALS],
  theme: 'system',
  autoSaveRecordings: true,
  audioBeforeAnswer: false,
  typingColor: false,
  fitBox: true,
  strictUmlauts: false,
  secondTry: false,
};

/**
 * Settings that belong to one device and are never taken from another one: the neural voice (it has to be
 * downloaded on each device), the theme, and whether recordings are saved automatically.
 */
export const DEVICE_SETTINGS = ['voice', 'theme', 'autoSaveRecordings'] as const satisfies readonly (keyof Settings)[];
const isDeviceKey = (k: string) => (DEVICE_SETTINGS as readonly string[]).includes(k);

/** Only the device-only settings. */
export function deviceSettings(s: Partial<Settings>): Partial<Settings> {
  return Object.fromEntries(Object.entries(s).filter(([k, v]) => isDeviceKey(k) && v !== undefined)) as Partial<Settings>;
}

/** True if a change touches only device-only settings (nothing to sync). */
export function onlyDeviceSettings(patch: Partial<Settings>): boolean {
  return Object.keys(patch).every(isDeviceKey);
}

export interface VoiceOption {
  id: string;
  label: string;
  mb: number;
}

export const VOICES: VoiceOption[] = [
  { id: 'de_DE-thorsten-medium', label: 'Thorsten (male) — recommended', mb: 63 },
  { id: 'de_DE-thorsten-high', label: 'Thorsten HD (male, best quality, slower)', mb: 114 },
  { id: 'de_DE-kerstin-low', label: 'Kerstin (female)', mb: 63 },
  { id: 'de_DE-ramona-low', label: 'Ramona (female)', mb: 63 },
  { id: 'de_DE-eva_k-x_low', label: 'Eva (female, small download)', mb: 21 },
];
