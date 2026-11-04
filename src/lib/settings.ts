import type { Mode } from './session';
import { DEFAULT_INTERVALS } from './srs';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  roundSize: number;
  dailyGoal: number;
  mode: Mode;
  showHint: boolean;
  autoplay: boolean;
  rate: number;
  voice: string;
  intervals: number[];
  theme: Theme;
  /** download a level's recording bundle when you start playing it */
  autoSaveRecordings: boolean;
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
};

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
