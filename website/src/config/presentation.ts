/**
 * Presentation Configuration
 * Single source of truth for DORN Católica 2026 event content
 * Loaded from resources/pilot/catolica-2026-09-08.json
 */

export interface PresentationConfig {
  event: {
    name: string;
    date: string;
    location: string;
    timeZone: string;
  };
  project: {
    name: string;
    tagline: string;
    missionStatement: string;
  };
  problem: {
    title: string;
    description: string;
  };
  product: {
    name: string;
    components: Array<{
      name: string;
      role: string;
      status: string;
      note: string;
    }>;
    includes: string[];
  };
  pilot: {
    name: string;
    description: string;
    logic: {
      onDuration: number;
      onUnit: string;
      offDuration: number;
      offUnit: string;
      execution: string;
      voiceCommand: string;
      manualStop: boolean;
      internetRequired: boolean;
      aiDecisionRequired: boolean;
    };
    flow: string;
    safetyNote: string;
  };
  customers: {
    initial: string[];
    sectors: string[];
    note: string;
  };
  revenue: {
    model: Array<{
      item: string;
      description: string;
    }>;
    pricing: string;
    note: string;
  };
  status: {
    overall: string;
    proven: string[];
    pending: string[];
  };
  contact: {
    email: string | null;
    form: string | null;
    url: string | null;
    note: string;
  };
  motionsites: {
    mobileAppRoute: string;
    videoReference: string;
    videoUsage: string;
    note: string;
  };
  prohibitions: {
    hardware: string[];
    product: string[];
    capabilities: string[];
    evidence: string[];
  };
}

// Load from imported JSON
import configData from '../../../resources/pilot/catolica-2026-09-08.json';

export const config: PresentationConfig = configData as PresentationConfig;

// Event details
export const eventDate = new Date(config.event.date);
export const eventDateFormatted = eventDate.toLocaleDateString('es-CL', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

// Shortcuts for commonly used values
export const PILOT_CYCLE = {
  ON_MINUTES: config.pilot.logic.onDuration,
  OFF_MINUTES: config.pilot.logic.offDuration,
  VOICE_COMMAND: config.pilot.logic.voiceCommand,
};

export const HARDWARE_STATUS = {
  P4: 'DISPLAY_ONLY',
  S3: 'REQUIRES_PRETEST',
  PC: 'DEMO_MODE',
  MOBILE: 'DEMO_MODE',
};

export const MOBILE_APP_ROUTE = config.motionsites.mobileAppRoute;
