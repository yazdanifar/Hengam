import { useEffect, useId, useRef, useState } from 'react'
import { toFaDigits } from '@shared/format'
import {
  ALERT_UNIT_LABELS,
  ALERT_UNIT_MINUTES,
  maxAlertValue,
  splitAlertMinutes,
  type AlertUnit
} from '@shared/notifications'

interface Props {
  /** Who fails, as it reads in "اگر {subject} … پیاپی ناموفق بود". */
  subject: string
  initialMinutes: number
  onChange(minutes: number): void
}

function parseValue(text: string, unit: AlertUnit): number | undefined {
  const n = Number(text)
  return text.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= maxAlertValue(unit) ? n : undefined
}

/**
 * "If {subject} keeps failing for [N] [hours|days], alert me."
 *
 * Saves only a finished, valid value: when the number field is left, when the unit
 * changes, or when the dialog closes with an edit pending. Saving per keystroke would
 * store the valid prefix of an invalid entry (typing 721 saves 72), leaving the
 * dialog showing one value while another is in effect.
 *
 * Seeded once from `initialMinutes`, then it owns its state, so a save round trip
 * never rewrites what the user typed (24 hours stays 24 hours, not 1 day).
 */
export function AlertThresholdField({ subject, initialMinutes, onChange }: Props) {
  const initial = splitAlertMinutes(initialMinutes)
  const [text, setText] = useState(String(initial.value))
  const [unit, setUnit] = useState<AlertUnit>(initial.unit)
  const errorId = useId()
  const valid = parseValue(text, unit) !== undefined

  const saved = useRef(initialMinutes)
  const pending = useRef<number | undefined>(undefined)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  function commit(): void {
    if (pending.current !== undefined && pending.current !== saved.current) {
      saved.current = pending.current
      onChangeRef.current(pending.current)
    }
    pending.current = undefined
  }

  // Closing the dialog (Escape, backdrop, "بستن") unmounts the field without a blur.
  useEffect(() => commit, [])

  function update(nextText: string, nextUnit: AlertUnit): void {
    setText(nextText)
    setUnit(nextUnit)
    const value = parseValue(nextText, nextUnit)
    pending.current = value === undefined ? undefined : value * ALERT_UNIT_MINUTES[nextUnit]
  }

  return (
    <fieldset className="threshold-field">
      <legend>هشدار خرابی</legend>
      <div className="threshold-row">
        <span>اگر {subject}</span>
        <input
          type="number"
          className="threshold-value"
          inputMode="numeric"
          min={1}
          max={maxAlertValue(unit)}
          aria-label="مدت"
          aria-invalid={!valid}
          aria-describedby={valid ? undefined : errorId}
          value={text}
          onChange={(e) => update(e.target.value, unit)}
          onBlur={commit}
        />
        <select
          className="threshold-unit"
          aria-label="واحد مدت"
          value={unit}
          onChange={(e) => {
            update(text, e.target.value as AlertUnit)
            commit()
          }}
        >
          {(Object.keys(ALERT_UNIT_LABELS) as AlertUnit[]).map((u) => (
            <option key={u} value={u}>
              {ALERT_UNIT_LABELS[u]}
            </option>
          ))}
        </select>
        <span>پیاپی ناموفق بود، در اعلان‌ها هشدار بده.</span>
      </div>
      {!valid && (
        <div className="error-text" id={errorId} role="alert">
          عددی صحیح بین ۱ و {toFaDigits(maxAlertValue(unit))} وارد کنید.
        </div>
      )}
    </fieldset>
  )
}
