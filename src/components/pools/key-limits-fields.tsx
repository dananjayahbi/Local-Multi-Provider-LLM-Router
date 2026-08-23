"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Controlled form model for all the per-key limit fields.
 * Numeric fields are kept as strings so empty inputs can map to `null` (unlimited).
 */
export interface KeyLimitsForm {
  rpmLimit: string;
  tpmLimit: string;
  rpdLimit: string;
  tpdLimit: string;
  tps: string;
  timeToFirstTokenMs: string;
  contextWindow: string;
  cacheCapable: boolean;
  cacheDiscountFactor: string;
  autoCalibration: boolean;
}

/** Fresh blank limits form (all numeric fields empty = unlimited). */
export function emptyKeyLimitsForm(): KeyLimitsForm {
  return {
    rpmLimit: "",
    tpmLimit: "",
    rpdLimit: "",
    tpdLimit: "",
    tps: "",
    timeToFirstTokenMs: "",
    contextWindow: "",
    cacheCapable: false,
    cacheDiscountFactor: "0.1",
    autoCalibration: false,
  };
}

/** Convert a limits form into the API payload shape (empty numeric fields become `null`). */
export function keyLimitsToPayload(form: KeyLimitsForm) {
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const flt = (v: string): number | null => (v.trim() === "" ? null : parseFloat(v));
  return {
    rpmLimit: num(form.rpmLimit),
    tpmLimit: num(form.tpmLimit),
    rpdLimit: num(form.rpdLimit),
    tpdLimit: num(form.tpdLimit),
    tps: flt(form.tps),
    timeToFirstTokenMs: num(form.timeToFirstTokenMs),
    contextWindow: num(form.contextWindow),
    cacheCapable: form.cacheCapable,
    cacheDiscountFactor: flt(form.cacheDiscountFactor),
    autoCalibration: form.autoCalibration,
  };
}

/** Populate a limits form from an existing ApiKey for editing. */
export function keyLimitsFromApiKey(key: {
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  rpdLimit?: number | null;
  tpdLimit?: number | null;
  tps?: number | null;
  timeToFirstTokenMs?: number | null;
  contextWindow?: number | null;
  cacheCapable?: boolean;
  cacheDiscountFactor?: number;
  autoCalibration?: boolean;
}): KeyLimitsForm {
  return {
    rpmLimit: key.rpmLimit != null ? String(key.rpmLimit) : "",
    tpmLimit: key.tpmLimit != null ? String(key.tpmLimit) : "",
    rpdLimit: key.rpdLimit != null ? String(key.rpdLimit) : "",
    tpdLimit: key.tpdLimit != null ? String(key.tpdLimit) : "",
    tps: key.tps != null ? String(key.tps) : "",
    timeToFirstTokenMs: key.timeToFirstTokenMs != null ? String(key.timeToFirstTokenMs) : "",
    contextWindow: key.contextWindow != null ? String(key.contextWindow) : "",
    cacheCapable: key.cacheCapable ?? false,
    cacheDiscountFactor: key.cacheDiscountFactor != null ? String(key.cacheDiscountFactor) : "0.1",
    autoCalibration: key.autoCalibration ?? false,
  };
}

interface KeyLimitsFieldsProps {
  value: KeyLimitsForm;
  onChange: (next: KeyLimitsForm) => void;
}

/** Renders all the per-key limit + caching fields in a grid. Empty numeric = "∞" (unlimited). */
export function KeyLimitsFields({ value, onChange }: KeyLimitsFieldsProps) {
  const set = (patch: Partial<KeyLimitsForm>) => onChange({ ...value, ...patch });

  const numField = (
    key: keyof Pick<KeyLimitsForm, "rpmLimit" | "tpmLimit" | "rpdLimit" | "tpdLimit" | "timeToFirstTokenMs" | "contextWindow">,
    label: string
  ) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        value={value[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<KeyLimitsForm>)}
        placeholder="∞"
        type="number"
        min="1"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {numField("rpmLimit", "RPM Limit (requests/min)")}
        {numField("tpmLimit", "TPM Limit (tokens/min)")}
        {numField("rpdLimit", "RPD Limit (requests/day)")}
        {numField("tpdLimit", "TPD Limit (tokens/day)")}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Tokens / sec</Label>
          <Input
            value={value.tps}
            onChange={(e) => set({ tps: e.target.value })}
            placeholder="∞"
            type="number"
            min="0"
            step="any"
          />
        </div>
        <div className="space-y-2">
          <Label>First Token (ms)</Label>
          <Input
            value={value.timeToFirstTokenMs}
            onChange={(e) => set({ timeToFirstTokenMs: e.target.value })}
            placeholder="∞"
            type="number"
            min="1"
          />
        </div>
        <div className="space-y-2">
          <Label>Context Window</Label>
          <Input
            value={value.contextWindow}
            onChange={(e) => set({ contextWindow: e.target.value })}
            placeholder="∞"
            type="number"
            min="1"
          />
        </div>
      </div>
      <div className="flex items-end gap-4">
        <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
          <input
            type="checkbox"
            checked={value.cacheCapable}
            onChange={(e) => set({ cacheCapable: e.target.checked })}
          />
          Cache Capable
        </label>
        <div className="space-y-2 flex-1">
          <Label>Cache Discount Factor</Label>
          <Input
            value={value.cacheDiscountFactor}
            onChange={(e) => set({ cacheDiscountFactor: e.target.value })}
            type="number"
            min="0"
            max="1"
            step="0.01"
            placeholder="0.1"
          />
        </div>
      </div>

      {/* Auto-calibration: dynamically tune limits based on live provider
          outcomes (rate-limits scale down, success streaks probe up). */}
      <div className="flex items-start gap-3 rounded-md border p-3">
        <input
          type="checkbox"
          id="autoCalibration"
          className="mt-1"
          checked={value.autoCalibration}
          onChange={(e) => set({ autoCalibration: e.target.checked })}
        />
        <div className="space-y-1">
          <Label htmlFor="autoCalibration" className="cursor-pointer">
            Auto-calibration
          </Label>
          <p className="text-xs text-muted-foreground">
            When enabled, the router watches real usage and tunes this key's
            RPM/TPM/RPD/TPD toward its true ceiling: rate-limit errors scale
            limits down, sustained success scales them back up. The limits you
            set here become the maximum ceiling.
          </p>
        </div>
      </div>
    </div>
  );
}
