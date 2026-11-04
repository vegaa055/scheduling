# Importing courses and sections

Admin → Import sections loads a term's courses and sections from a CSV file, such as an export
from the registrar's system or a spreadsheet saved as CSV. Admins and schedulers can use it.

The import always checks the file first and shows what it would change. Nothing is saved until
you choose **Import**, and then either every change is made or none are.

## Columns

Header names are matched without regard to case, spaces or dashes, so `Catalog Nbr` and
`catalog_nbr` are the same column. Columns the import doesn't use are ignored and listed as a
note.

| Column | Also accepted | Required | What it holds |
| --- | --- | --- | --- |
| `subject` | `subj`, `subject_code` | Yes | Subject code, like `CHEM` |
| `number` | `catalog`, `catalog_number`, `catalog_nbr`, `course_number`, `nbr` | Yes | Catalog number, like `151` or `151L` |
| `section` | `section_number`, `class_section`, `sect` | Yes | Section number, like `001` |
| `cap` | `enrollment_cap`, `enrl_cap`, `capacity`, `max_enrollment` | Yes | Enrollment cap, 1 to 5000 |
| `patterns` | `allowed_patterns`, `pattern`, `meeting_patterns` | Yes | Meeting pattern families the section may meet in, separated by spaces, like `MWF50 TR75`. Each must exist in the term (Admin → Terms). |
| `title` | `course_title`, `descr`, `description` | New courses | Course title. A different title for an existing course updates it. |
| `department` | `dept`, `department_code`, `dept_code` | New courses | Department code (Admin → Departments) |
| `credits` | `units`, `credit_hours` | No | 0 to 12; new courses default to 3 |
| `instructor_netid` | `instructor`, `netid` | No | NetID; an `@domain` suffix is dropped. A blank cell removes the instructor. |
| `instructor_name` | | No | Lets the import add an instructor who isn't in the app yet |
| `instructor_email` | | No | Saved for a newly added instructor |
| `features` | `required_features`, `room_features` | No | Room features the section needs, like `wet_lab` |
| `cohorts` | `cohort` | No | Groups of students who take these sections together; the Schedule builder keeps sections that share a cohort from overlapping |

Lists inside a cell can be separated by spaces, semicolons or vertical bars.

## What the import does

- **Matching.** Courses match on subject and number. Sections match on course, term and
  section number.
- **Columns you leave out aren't changed.** A file without a `features` column keeps every
  section's features as they are.
- **Sections not in the file stay as they are.** The import never deletes. The check reports
  how many of the term's sections the file doesn't mention.
- **New instructors.** An unknown NetID with an `instructor_name` adds that person with the
  faculty role, in the department of the first course the file lists them for. Their name,
  email and roles update from campus sign-in when they first sign in. An unknown NetID without
  a name is an error.
- **Published sections.** Changing a section that's already on the class calendars doesn't
  move its calendar events. The check counts these sections; publish the term again from the
  Schedule builder to update them.
- **Placement is kept.** The import changes what a section needs, not where it meets. Run the
  Schedule builder afterwards to place new sections.

## Round trip

Admin → Import sections → **Download *term* sections** exports a term in this format. Edit it in a
spreadsheet and import it again to update sections in bulk. The export puts an apostrophe in
front of cells that start with `=`, `+` or `@` so spreadsheet apps don't run them as formulas;
the import removes it again.

The parser and the planning logic are in `apps/api/src/lib/csv.ts` and
`apps/api/src/lib/section-import.ts`, with tests in `section-import.test.ts`.
