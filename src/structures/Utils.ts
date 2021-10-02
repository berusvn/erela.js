/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars, @typescript-eslint/no-var-requires*/
import { Manager } from "./Manager";
import { Node, NodeStats } from "./Node";
import { Player, Track, UnresolvedTrack } from "./Player";
import { Queue } from "./Queue";

/** @hidden */
const template = [
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "year"
];

/** @hidden */
const TRACK_SYMBOL = Symbol("track"),
  /** @hidden */
  UNRESOLVED_TRACK_SYMBOL = Symbol("unresolved"),
  SIZES = [
    "0",
    "1",
    "2",
    "3",
    "default",
    "mqdefault",
    "hqdefault",
    "maxresdefault",
  ];

/** @hidden */
const escapeRegExp = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export abstract class TrackUtils {
  static trackPartial: string[] | null = null;
  private static manager: Manager;

  /** @hidden */
  public static init(manager: Manager): void {
    this.manager = manager;
  }

  static setTrackPartial(partial: string[]): void {
    if (!Array.isArray(partial) || !partial.every(str => typeof str === "string"))
      throw new Error("Provided partial is not an array or not a string array.");
    if (!partial.includes("track")) partial.unshift("track");

    this.trackPartial = partial;
  }

  /**
   * Checks if the provided argument is a valid Track or UnresolvedTrack, if provided an array then every element will be checked.
   * @param trackOrTracks
   */
  static validate(trackOrTracks: unknown): boolean {
    if (typeof trackOrTracks === "undefined")
      throw new RangeError("Provided argument must be present.");

    if (Array.isArray(trackOrTracks) && trackOrTracks.length) {
      for (const track of trackOrTracks) {
        if (!(track[TRACK_SYMBOL] || track[UNRESOLVED_TRACK_SYMBOL])) return false
      }
      return true;
    }

    return (
      trackOrTracks[TRACK_SYMBOL] ||
      trackOrTracks[UNRESOLVED_TRACK_SYMBOL]
    ) === true;
  }

  /**
   * Checks if the provided argument is a valid UnresolvedTrack.
   * @param track
   */
  static isUnresolvedTrack(track: unknown): boolean {
    if (typeof track === "undefined")
      throw new RangeError("Provided argument must be present.");
    return track[UNRESOLVED_TRACK_SYMBOL] === true;
  }

  /**
   * Checks if the provided argument is a valid Track.
   * @param track
   */
  static isTrack(track: unknown): boolean {
    if (typeof track === "undefined")
      throw new RangeError("Provided argument must be present.");
    return track[TRACK_SYMBOL] === true;
  }

  /**
   * Builds a Track from the raw data from Lavalink and a optional requester.
   * @param data
   * @param requester
   */
  static build(data: TrackData, requester?: unknown): Track {
    if (typeof data === "undefined")
      throw new RangeError('Argument "data" must be present.');

    try {
      const track: Track = {
        track: data.track,
        title: data.info.title,
        identifier: data.info.identifier,
        author: data.info.author,
        duration: data.info.length,
        isSeekable: data.info.isSeekable,
        isStream: data.info.isStream,
        uri: data.info.uri,
        thumbnail: data.info.uri.includes("youtube")
          ? `https://img.youtube.com/vi/${data.info.identifier}/default.jpg`
          : null,
        displayThumbnail(size = "default"): string | null {
          const finalSize = SIZES.find((s) => s === size) ?? "default";
          return this.uri.includes("youtube")
            ? `https://img.youtube.com/vi/${data.info.identifier}/${finalSize}.jpg`
            : null;
        },
        requester,
      };

      track.displayThumbnail = track.displayThumbnail.bind(track);

      if (this.trackPartial) {
        for (const key of Object.keys(track)) {
          if (this.trackPartial.includes(key)) continue;
          delete track[key];
        }
      }

      Object.defineProperty(track, TRACK_SYMBOL, {
        configurable: true,
        value: true
      });

      return track;
    } catch (error) {
      throw new RangeError(`Argument "data" is not a valid track: ${error.message}`);
    }
  }

  /**
   * Builds a UnresolvedTrack to be resolved before being played  .
   * @param query
   * @param requester
   */
  static buildUnresolved(query: string | UnresolvedQuery, requester?: unknown): UnresolvedTrack {
    if (typeof query === "undefined")
      throw new RangeError('Argument "query" must be present.');

    let unresolvedTrack: Partial<UnresolvedTrack> = {
      requester,
      async resolve(): Promise<void> {
        const resolved = await TrackUtils.getClosestTrack(this)
        Object.getOwnPropertyNames(this).forEach(prop => delete this[prop]);
        Object.assign(this, resolved);
      }
    };

    if (typeof query === "string") unresolvedTrack.title = query;
    else unresolvedTrack = { ...unresolvedTrack, ...query }

    Object.defineProperty(unresolvedTrack, UNRESOLVED_TRACK_SYMBOL, {
      configurable: true,
      value: true
    });

    return unresolvedTrack as UnresolvedTrack;
  }

  static async getClosestTrack(
    unresolvedTrack: UnresolvedTrack
  ): Promise<Track> {
    if (!TrackUtils.manager) throw new RangeError("Manager has not been initiated.");

    if (!TrackUtils.isUnresolvedTrack(unresolvedTrack))
      throw new RangeError("Provided track is not a UnresolvedTrack.");

    const query = [unresolvedTrack.author, unresolvedTrack.title].filter(str => !!str).join(" - ");
    const res = await TrackUtils.manager.search(query, unresolvedTrack.requester);

    if (res.loadType !== "SEARCH_RESULT") throw res.exception ?? {
      message: "No tracks found.",
      severity: "COMMON",
    };

    if (unresolvedTrack.author) {
      const channelNames = [unresolvedTrack.author, `${unresolvedTrack.author} - Topic`];

      const originalAudio = res.tracks.find(track => {
        return (
          channelNames.some(name => new RegExp(`^${escapeRegExp(name)}$`, "i").test(track.author)) ||
          new RegExp(`^${escapeRegExp(unresolvedTrack.title)}$`, "i").test(track.title)
        );
      });

      if (originalAudio) return originalAudio;
    }

    if (unresolvedTrack.duration) {
      const sameDuration = res.tracks.find(track =>
        (track.duration >= (unresolvedTrack.duration - 1500)) &&
        (track.duration <= (unresolvedTrack.duration + 1500))
      );

      if (sameDuration) return sameDuration;
    }

    return res.tracks[0];
  }
}

export class Utils {
  /**
   * Formats the given duration into human readable format.
   * @param {number} milliseconds The duration to format.
   * @param {boolean?} [minimal=false] Whether to use a minimal format.
   * @returns {string} The formatted duration.
   */
  public static formatTime(milliseconds: number, minimal = false): string {
      if (typeof milliseconds === "undefined" || isNaN(milliseconds)) {
          throw new RangeError("Utils#formatTime() Milliseconds must be a number");
      }

      if (typeof minimal !== "boolean") {
          throw new RangeError("Utils#formatTime() Minimal must be a boolean");
      }

      if (milliseconds === 0) return minimal ? "00:00" : "N/A";

      const times = {
          years: 0,
          months: 0,
          weeks: 0,
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
      };

      while (milliseconds > 0) {
          if (milliseconds - 31557600000 >= 0) {
              milliseconds -= 31557600000;
              times.years++;
          } else if (milliseconds - 2628000000 >= 0) {
              milliseconds -= 2628000000;
              times.months++;
          } else if (milliseconds - 604800000 >= 0) {
              milliseconds -= 604800000;
              times.weeks += 7;
          } else if (milliseconds - 86400000 >= 0) {
              milliseconds -= 86400000;
              times.days++;
          } else if (milliseconds - 3600000 >= 0) {
              milliseconds -= 3600000;
              times.hours++;
          } else if (milliseconds - 60000 >= 0) {
              milliseconds -= 60000;
              times.minutes++;
          } else {
              times.seconds = Math.round(milliseconds / 1000);
              milliseconds = 0;
          }
      }

      const finalTime: string[] = [];
      let first = false;

      for (const [k, v] of Object.entries(times)) {
          if (minimal) {
              if (v === 0 && !first) continue;
              finalTime.push(v < 10 ? `0${v}` : `${v}`);
              first = true;
              continue;
          }
          if (v > 0) finalTime.push(`${v} ${v > 1 ? k : k.slice(0, -1)}`);
      }

      if (minimal && finalTime.length === 1) finalTime.unshift("00");

      let time = finalTime.join(minimal ? ":" : ", ");

      if (time.includes(",")) {
          const pos = time.lastIndexOf(",");
          time = `${time.slice(0, pos)} and ${time.slice(pos + 1)}`;
      }

      return time;
  }

  /**
   * Parses the given duration into milliseconds.
   * @param {string} time The duration to parse.
   * @returns {number} The formatted duration.
   */
  public static parseTime(time: string): number | null {
      if (time.includes(":")) time = time.split(":").reverse().map((v, i) => v + template[i]).join("");
      if (time.includes(" ")) time = time.split(/\s+/).join("");
      if (time.match(/^\d+$/)) time = `${time}seconds`;
      
      const regex = /\d+\.*\d*\D+/g;
      let res;
      let duration = 0;

      while ((res = regex.exec(time)) !== null) {
          if (res.index === regex.lastIndex) regex.lastIndex++;
          const local: string = res[0].toLowerCase();
          
          if (
              local.endsWith("seconds") ||
              local.endsWith("second") ||
              (local.endsWith("s") && (local.match(/\D+/) as string[])[0].length === 1)
          ) {
              duration +=
              parseInt((local.match(/\d+\.*\d*/) as string[])[0], 10) * 1000;
          } else if (
              local.endsWith("minutes") ||
              local.endsWith("minute") ||
              (local.endsWith("m") && (local.match(/\D+/) as string[])[0].length === 1)
          ) {
              duration +=
              parseInt((local.match(/\d+\.*\d*/) as string[])[0], 10) * 60000;
          } else if (
              local.endsWith("hours") ||
              local.endsWith("hour") ||
              (local.endsWith("h") && (local.match(/\D+/) as string[])[0].length === 1)
          ) {
              duration +=
              parseInt((local.match(/\d+\.*\d*/) as string[])[0], 10) * 3600000;
          } else if (
              local.endsWith("days") ||
              local.endsWith("day") ||
              (local.endsWith("d") && (local.match(/\D+/) as string[])[0].length === 1)
          ) {
              duration +=
              parseInt((local.match(/\d+\.*\d*/) as string[])[0], 10) * 86400000;
          } else if (
              local.endsWith("weeks") ||
              local.endsWith("week") ||
              (local.endsWith("w") && (local.match(/\D+/) as string[])[0].length === 1)
          ) {
              duration +=
              parseInt((local.match(/\d+\.*\d*/) as string[])[0], 10) * 604800000;
          } else if (local.endsWith("months") || local.endsWith("month")) {
              duration +=
              parseInt((local.match(/\d+\.*\d*/) as string[])[0], 10) * 2628000000;
          } else if (
              local.endsWith("years") ||
              local.endsWith("year") ||
              (local.endsWith("y") && (local.match(/\D+/) as string[])[0].length === 1)
          ) {
              duration +=
              parseInt((local.match(/\d+\.*\d*/) as string[])[0], 10) * 31557600000;
          }
      }

      if (duration === 0) return null;
      return duration;
  }
}

/** Gets or extends structures to extend the built in, or already extended, classes to add more functionality. */
export abstract class Structure {
  /**
   * Extends a class.
   * @param name
   * @param extender
   */
  public static extend<K extends keyof Extendable, T extends Extendable[K]>(
    name: K,
    extender: (target: Extendable[K]) => T
  ): T {
    if (!structures[name]) throw new TypeError(`"${name} is not a valid structure`);
    const extended = extender(structures[name]);
    structures[name] = extended;
    return extended;
  }

  /**
   * Get a structure from available structures by name.
   * @param name
   */
  public static get<K extends keyof Extendable>(name: K): Extendable[K] {
    const structure = structures[name];
    if (!structure) throw new TypeError('"structure" must be provided.');
    return structure;
  }
}

export class Plugin {
  public load(manager: Manager): void {}

  public unload(manager: Manager): void {}
}

const structures = {
  Player: require("./Player").Player,
  Queue: require("./Queue").Queue,
  Node: require("./Node").Node,
};

export interface UnresolvedQuery {
  /** The title of the unresolved track. */
  title: string;
  /** The author of the unresolved track. If provided it will have a more precise search. */
  author?: string;
  /** The duration of the unresolved track. If provided it will have a more precise search. */
  duration?: number;
}

export type Sizes =
  | "0"
  | "1"
  | "2"
  | "3"
  | "default"
  | "mqdefault"
  | "hqdefault"
  | "maxresdefault";

export type LoadType =
  | "TRACK_LOADED"
  | "PLAYLIST_LOADED"
  | "SEARCH_RESULT"
  | "LOAD_FAILED"
  | "NO_MATCHES";

export type State =
  | "CONNECTED"
  | "CONNECTING"
  | "DISCONNECTED"
  | "DISCONNECTING"
  | "DESTROYING";

export type PlayerEvents =
  | TrackStartEvent
  | TrackEndEvent
  | TrackStuckEvent
  | TrackExceptionEvent
  | WebSocketClosedEvent;

export type PlayerEventType =
  | "TrackStartEvent"
  | "TrackEndEvent"
  | "TrackExceptionEvent"
  | "TrackStuckEvent"
  | "WebSocketClosedEvent";

export type TrackEndReason =
  | "FINISHED"
  | "LOAD_FAILED"
  | "STOPPED"
  | "REPLACED"
  | "CLEANUP";

export type Severity = "COMMON" | "SUSPICIOUS" | "FAULT";

export interface TrackData {
  track: string;
  info: TrackDataInfo;
}

export interface TrackDataInfo {
  title: string;
  identifier: string;
  author: string;
  length: number;
  isSeekable: boolean;
  isStream: boolean;
  uri: string;
}

export interface Extendable {
  Player: typeof Player;
  Queue: typeof Queue;
  Node: typeof Node;
}

export interface VoiceState {
  op: "voiceUpdate";
  guildId: string;
  event: VoiceEvent;
  sessionId?: string;
}

export interface VoiceEvent {
  token: string;
  guild_id: string;
  endpoint: string;
}

export interface VoicePacket {
  t?: string;
  d: Partial<{
    guild_id: string;
    user_id: string;
    session_id: string;
    channel_id: string;
  }> &
    VoiceEvent;
}

export interface NodeMessage extends NodeStats {
  type: PlayerEventType;
  op: "stats" | "playerUpdate" | "event";
  guildId: string;
}

export interface PlayerEvent {
  op: "event";
  type: PlayerEventType;
  guildId: string;
}

export interface Exception {
  severity: Severity;
  message: string;
  cause: string;
}

export interface TrackStartEvent extends PlayerEvent {
  type: "TrackStartEvent";
  track: string;
}

export interface TrackEndEvent extends PlayerEvent {
  type: "TrackEndEvent";
  track: string;
  reason: TrackEndReason;
}

export interface TrackExceptionEvent extends PlayerEvent {
  type: "TrackExceptionEvent";
  exception?: Exception;
  error: string;
}

export interface TrackStuckEvent extends PlayerEvent {
  type: "TrackStuckEvent";
  thresholdMs: number;
}

export interface WebSocketClosedEvent extends PlayerEvent {
  type: "WebSocketClosedEvent";
  code: number;
  byRemote: boolean;
  reason: string;
}

export interface PlayerUpdate {
  op: "playerUpdate";
  state: {
    position: number;
    time: number;
  };
  guildId: string;
}