package edu.college.scheduling.solver.domain;

import static edu.college.scheduling.solver.domain.TimetableConstraints.*;

import edu.college.scheduling.solver.rest.Dto;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Explains a solution constraint by constraint, for the scheduler's review screen.
 *
 * Timefold's built-in score analysis is a commercial feature in Solver 2.x, so this re-applies
 * the same rules as {@link TimetableConstraints} directly to the final solution. The solver's own
 * score stays authoritative; keep the two in step when constraints change
 * (TimetableConstraintsTest covers the rules, ScoreReportTest checks they agree).
 */
public final class ScoreReport {
    private static final int MAX_JUSTIFICATIONS = 12;

    private final Map<String, Bucket> buckets = new LinkedHashMap<>();

    private static final class Bucket {
        final String level;
        long weight;
        int count;
        final List<String> reasons = new ArrayList<>();

        Bucket(String level) { this.level = level; }
    }

    private void add(String name, String level, long weight, String reason) {
        Bucket b = buckets.computeIfAbsent(name, k -> new Bucket(level));
        b.weight += weight;
        b.count++;
        if (b.reasons.size() < MAX_JUSTIFICATIONS) b.reasons.add(reason);
    }

    public static List<Dto.ConstraintOut> explain(Timetable t) {
        ScoreReport r = new ScoreReport();
        List<Section> placed = t.getSections().stream().filter(s -> s.getTimeslot() != null && s.getRoom() != null).toList();

        for (Section s : t.getSections()) {
            if (s.getTimeslot() == null || s.getRoom() == null) {
                r.add(NOT_PLACED, "medium", -1, s.getLabel() + " has no "
                        + (s.getTimeslot() == null ? (s.getRoom() == null ? "time or room" : "time") : "room"));
            }
        }
        for (int i = 0; i < placed.size(); i++) {
            Section a = placed.get(i);
            for (int j = i + 1; j < placed.size(); j++) {
                Section b = placed.get(j);
                boolean overlap = a.getTimeslot().overlaps(b.getTimeslot());
                if (overlap && a.getRoom() == b.getRoom()) {
                    r.add(ROOM_DOUBLE_BOOKED, "hard", -1, a.getLabel() + " and " + b.getLabel() + " are both in " + a.getRoom().getLabel());
                }
                boolean sameInstructor = a.getInstructorId() != null && a.getInstructorId().equals(b.getInstructorId());
                if (overlap && sameInstructor) {
                    r.add(INSTRUCTOR_DOUBLE_BOOKED, "hard", -1, a.getInstructorName() + " teaches " + a.getLabel() + " and " + b.getLabel() + " at the same time");
                }
                if (overlap && !courseOf(a).equals(courseOf(b)) && a.sharesCohortWith(b)) {
                    r.add(COHORT_OVERLAP, "hard", -1, a.getLabel() + " and " + b.getLabel() + " overlap; both are taken by " + a.sharedCohort(b));
                }
                if (sameInstructor && a.getTimeslot().sharesDay(b.getTimeslot())
                        && !a.getRoom().getBuilding().equals(b.getRoom().getBuilding())) {
                    long gap = a.getTimeslot().gapMinutes(b.getTimeslot());
                    if (gap >= 0 && gap < 30) {
                        r.add(BUILDING_CHANGE, "soft", -3, a.getInstructorName() + " goes from " + a.getRoom().getBuilding() + " to " + b.getRoom().getBuilding() + " with under 30 minutes between classes");
                    }
                }
            }
        }
        for (Section s : placed) {
            Room room = s.getRoom();
            Timeslot ts = s.getTimeslot();
            if (room.getCapacity() < s.getEnrollmentCap()) {
                r.add(ROOM_TOO_SMALL, "hard", -(1 + (s.getEnrollmentCap() - room.getCapacity()) / 10),
                        s.getLabel() + " caps at " + s.getEnrollmentCap() + " but " + room.getLabel() + " seats " + room.getCapacity());
            } else if (room.getCapacity() - s.getEnrollmentCap() >= 10) {
                r.add(EMPTY_SEATS, "soft", -((room.getCapacity() - s.getEnrollmentCap()) / 10),
                        s.getLabel() + " (" + s.getEnrollmentCap() + ") in " + room.getLabel() + " (" + room.getCapacity() + " seats)");
            }
            if (!room.hasAll(s.getRequiredFeatures())) {
                r.add(MISSING_EQUIPMENT, "hard", -1, s.getLabel() + " needs " + String.join(", ", s.getRequiredFeatures()).replace('_', ' '));
            }
            if (!s.getAllowedFamilies().contains(ts.getFamily())) {
                r.add(WRONG_PATTERN, "hard", -1, s.getLabel() + " can't meet " + ts.getFamily());
            }
            if (ts.getStart().isBefore(LocalTime.of(9, 0)) || !ts.getStart().isBefore(LocalTime.of(17, 0))) {
                r.add(EARLY_OR_LATE, "soft", -3, s.getLabel() + " starts at " + ts.getStart());
            }
            for (Availability a : t.getAvailability()) {
                if (!a.instructorId().equals(s.getInstructorId()) || !a.overlaps(ts)) continue;
                switch (a.preference()) {
                    case UNAVAILABLE -> r.add(INSTRUCTOR_UNAVAILABLE, "hard", -1, s.getInstructorName() + " is unavailable " + a.day() + " " + a.start() + "-" + a.end() + " (" + s.getLabel() + ")");
                    case UNDESIRED -> r.add(UNDESIRED_TIME, "soft", -10, s.getInstructorName() + " would rather not teach " + s.getLabel() + " at " + ts.label());
                    case PREFERRED -> r.add(PREFERRED_TIME, "soft", 5, s.getLabel() + " is in " + s.getInstructorName() + "'s preferred time");
                }
            }
        }

        List<Dto.ConstraintOut> out = new ArrayList<>();
        // Hard first, then medium, then soft (most costly first within a level).
        for (String level : List.of("hard", "medium", "soft")) {
            r.buckets.entrySet().stream()
                    .filter(e -> e.getValue().level.equals(level))
                    .sorted((x, y) -> Long.compare(x.getValue().weight, y.getValue().weight))
                    .forEach(e -> out.add(new Dto.ConstraintOut(e.getKey(), format(level, e.getValue().weight), e.getValue().count, e.getValue().reasons)));
        }
        return out;
    }

    private static String format(String level, long w) {
        return switch (level) {
            case "hard" -> w + "hard/0medium/0soft";
            case "medium" -> "0hard/" + w + "medium/0soft";
            default -> "0hard/0medium/" + w + "soft";
        };
    }

    static String courseOf(Section s) {
        String label = s.getLabel();
        int dash = label.lastIndexOf('-');
        return dash > 0 ? label.substring(0, dash) : label;
    }
}
