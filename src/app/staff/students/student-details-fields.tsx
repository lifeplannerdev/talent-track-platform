"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { GERMAN_LEVELS, STUDENT_STATUSES, type StudentDetails, type StudentDetailsInput } from "@/lib/student-details";

// Shared form sections for the study-abroad details (Add student and the student page). Personal
// data: every input has autocomplete="off" so a browser never fills in the staff member's own
// details. Values are plain strings; the server action validates and normalises them.

export type DetailsValues = Required<StudentDetailsInput>;
export type DetailsKey = keyof DetailsValues;

export const EMPTY_DETAILS: DetailsValues = {
  contactEmail: "",
  phone: "",
  guardianName: "",
  guardianPhone: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  passportNumber: "",
  passportExpiry: "",
  destinationCountry: "",
  targetIntake: "",
  germanLevel: "",
  qualification: "",
  joinedOn: "",
  programmeStart: "",
  status: "active",
  notes: "",
};

/** Form values from a stored details row (null = nothing saved yet). */
export function detailsToValues(d: StudentDetails | null): DetailsValues {
  if (!d) return { ...EMPTY_DETAILS };
  const out = { ...EMPTY_DETAILS };
  for (const key of Object.keys(EMPTY_DETAILS) as DetailsKey[]) out[key] = (d[key] ?? "") as string;
  return out;
}

const STATUS_LABELS: Record<(typeof STUDENT_STATUSES)[number], string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  dropped: "Dropped",
};

type SectionProps = { values: DetailsValues; onChange: (key: DetailsKey) => (e: { target: { value: string } }) => void; idPrefix: string };

/** A labelled group of fields: fieldset + legend, with a short hint line. */
export function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 border-t pt-4 first:border-t-0 first:pt-0">
      <legend className="p-0 text-sm font-semibold">{title}</legend>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  id,
  label,
  hint,
  wide,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5${wide ? " sm:col-span-2" : ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ContactSection({ values, onChange, idPrefix }: SectionProps) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <FormSection title="Contact" hint="The invite email goes to the contact email.">
      <Field id={id("contactEmail")} label="Contact email" hint="Required. Shared emails (for example siblings) are allowed.">
        <Input
          id={id("contactEmail")}
          name="contactEmail"
          type="email"
          inputMode="email"
          required
          autoComplete="off"
          spellCheck={false}
          value={values.contactEmail}
          onChange={onChange("contactEmail")}
          aria-describedby={`${id("contactEmail")}-hint`}
        />
      </Field>
      <Field id={id("phone")} label="Phone">
        <Input id={id("phone")} name="phone" type="tel" inputMode="tel" autoComplete="off" value={values.phone} onChange={onChange("phone")} />
      </Field>
      <Field id={id("guardianName")} label="Guardian name">
        <Input id={id("guardianName")} name="guardianName" autoComplete="off" value={values.guardianName} onChange={onChange("guardianName")} />
      </Field>
      <Field id={id("guardianPhone")} label="Guardian phone">
        <Input
          id={id("guardianPhone")}
          name="guardianPhone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={values.guardianPhone}
          onChange={onChange("guardianPhone")}
        />
      </Field>
      <Field id={id("address")} label="Address" wide>
        <Textarea id={id("address")} name="address" rows={2} autoComplete="off" value={values.address} onChange={onChange("address")} />
      </Field>
    </FormSection>
  );
}

export function PassportSection({ values, onChange, idPrefix }: SectionProps) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <FormSection title="Passport and travel" hint="Private: only an admin and the student's trainer can see these.">
      <Field id={id("dateOfBirth")} label="Date of birth">
        <Input id={id("dateOfBirth")} name="dateOfBirth" type="date" autoComplete="off" value={values.dateOfBirth} onChange={onChange("dateOfBirth")} />
      </Field>
      <Field id={id("gender")} label="Gender">
        <NativeSelect id={id("gender")} name="gender" value={values.gender} onChange={onChange("gender")} className="w-full">
          <NativeSelectOption value="">Not set</NativeSelectOption>
          <NativeSelectOption value="Female">Female</NativeSelectOption>
          <NativeSelectOption value="Male">Male</NativeSelectOption>
          <NativeSelectOption value="Other">Other</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field id={id("passportNumber")} label="Passport number">
        <Input
          id={id("passportNumber")}
          name="passportNumber"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={values.passportNumber}
          onChange={onChange("passportNumber")}
        />
      </Field>
      <Field id={id("passportExpiry")} label="Passport expiry">
        <Input id={id("passportExpiry")} name="passportExpiry" type="date" autoComplete="off" value={values.passportExpiry} onChange={onChange("passportExpiry")} />
      </Field>
      <Field id={id("destinationCountry")} label="Destination country">
        <Input
          id={id("destinationCountry")}
          name="destinationCountry"
          autoComplete="off"
          value={values.destinationCountry}
          onChange={onChange("destinationCountry")}
        />
      </Field>
      <Field id={id("targetIntake")} label="Target intake" hint="For example October 2027.">
        <Input
          id={id("targetIntake")}
          name="targetIntake"
          autoComplete="off"
          value={values.targetIntake}
          onChange={onChange("targetIntake")}
          aria-describedby={`${id("targetIntake")}-hint`}
        />
      </Field>
    </FormSection>
  );
}

export function CourseSection({ values, onChange, idPrefix }: SectionProps) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <FormSection title="Course">
      <Field id={id("germanLevel")} label="German level">
        <NativeSelect id={id("germanLevel")} name="germanLevel" value={values.germanLevel} onChange={onChange("germanLevel")} className="w-full">
          <NativeSelectOption value="">Not set</NativeSelectOption>
          {GERMAN_LEVELS.map((l) => (
            <NativeSelectOption key={l} value={l}>
              {l}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field id={id("qualification")} label="Qualification">
        <Input id={id("qualification")} name="qualification" autoComplete="off" value={values.qualification} onChange={onChange("qualification")} />
      </Field>
      <Field id={id("joinedOn")} label="Joined on">
        <Input id={id("joinedOn")} name="joinedOn" type="date" autoComplete="off" value={values.joinedOn} onChange={onChange("joinedOn")} />
      </Field>
      <Field id={id("programmeStart")} label="Programme start">
        <Input id={id("programmeStart")} name="programmeStart" type="date" autoComplete="off" value={values.programmeStart} onChange={onChange("programmeStart")} />
      </Field>
      <Field id={id("status")} label="Status" hint="For information only; it does not change what the student can do.">
        <NativeSelect
          id={id("status")}
          name="status"
          value={values.status}
          onChange={onChange("status")}
          className="w-full"
          aria-describedby={`${id("status")}-hint`}
        >
          {STUDENT_STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {STATUS_LABELS[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
    </FormSection>
  );
}

export function NotesSection({ values, onChange, idPrefix }: SectionProps) {
  const id = `${idPrefix}-notes`;
  return (
    <FormSection title="Notes">
      <Field id={id} label="Internal notes" hint="Visible to an admin and the student's trainer, never to the student." wide>
        <Textarea id={id} name="notes" rows={3} autoComplete="off" value={values.notes} onChange={onChange("notes")} aria-describedby={`${id}-hint`} />
      </Field>
    </FormSection>
  );
}
