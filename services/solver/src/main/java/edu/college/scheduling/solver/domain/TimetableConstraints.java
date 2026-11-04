package edu.college.scheduling.solver.domain;

import static ai.timefold.solver.core.api.score.stream.Joiners.equal;
import static ai.timefold.solver.core.api.score.stream.Joiners.filtering;

import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.score.stream.Constraint;
import ai.timefold.solver.core.api.score.stream.ConstraintFactory;
import ai.timefold.solver.core.api.score.stream.ConstraintProvider;
import java.time.LocalTime;
import java.util.Objects;

/**
 * Hard: rules a published timetable must never break.
 * Medium: every section should be placed.
 * Soft: preferences that make the schedule better for people.
 *
 * Constraint names are shown to schedulers, so they are written in plain language.
 */
public class TimetableConstraints implements ConstraintProvider {

    public static final String ROOM_DOUBLE_BOOKED = "Room double-booked";
    public static final String INSTRUCTOR_DOUBLE_BOOKED = "Instructor double-booked";
    public static final String COHORT_OVERLAP = "Required courses overlap";
    public static final String ROOM_TOO_SMALL = "Room too small";
    public static final String MISSING_EQUIPMENT = "Room missing equipment";
    public static final String WRONG_PATTERN = "Meeting pattern not allowed";
    public static final String INSTRUCTOR_UNAVAILABLE = "Instructor unavailable";
    public static final String NOT_PLACED = "Section not placed";
    public static final String UNDESIRED_TIME = "Instructor would rather not teach then";
    public static final String PREFERRED_TIME = "Instructor's preferred time";
    public static final String EMPTY_SEATS = "Empty seats";
    public static final String EARLY_OR_LATE = "Early or late class";
    public static final String BUILDING_CHANGE = "Back-to-back in different buildings";

    private static final LocalTime EARLY = LocalTime.of(9, 0);
    private static final LocalTime LATE = LocalTime.of(17, 0);

    @Override
    public Constraint[] defineConstraints(ConstraintFactory f) {
        return new Constraint[] {
            roomDoubleBooked(f),
            instructorDoubleBooked(f),
            cohortOverlap(f),
            roomTooSmall(f),
            missingEquipment(f),
            wrongPattern(f),
            instructorUnavailable(f),
            notPlaced(f),
            undesiredTime(f),
            preferredTime(f),
            emptySeats(f),
            earlyOrLate(f),
            buildingChange(f),
        };
    }

    /* ---------------- Hard ---------------- */

    Constraint roomDoubleBooked(ConstraintFactory f) {
        return f.forEachUniquePair(Section.class,
                        equal(Section::getRoom),
                        filtering((a, b) -> a.getTimeslot().overlaps(b.getTimeslot())))
                .penalize(HardMediumSoftScore.ONE_HARD)
                .justifyWith((a, b, score) -> Explanation.of(
                        a.getLabel() + " and " + b.getLabel() + " are both in " + a.getRoom().getLabel()
                                + " (" + a.getTimeslot().label() + ")", a, b))
                .asConstraint(ROOM_DOUBLE_BOOKED);
    }

    Constraint instructorDoubleBooked(ConstraintFactory f) {
        return f.forEachUniquePair(Section.class,
                        equal(Section::getInstructorId),
                        filtering((a, b) -> a.getInstructorId() != null && a.getTimeslot().overlaps(b.getTimeslot())))
                .penalize(HardMediumSoftScore.ONE_HARD)
                .justifyWith((a, b, score) -> Explanation.of(
                        a.getInstructorName() + " teaches " + a.getLabel() + " and " + b.getLabel() + " at the same time", a, b))
                .asConstraint(INSTRUCTOR_DOUBLE_BOOKED);
    }

    Constraint cohortOverlap(ConstraintFactory f) {
        return f.forEachUniquePair(Section.class,
                        filtering((a, b) -> !Objects.equals(courseOf(a), courseOf(b))
                                && a.sharesCohortWith(b)
                                && a.getTimeslot().overlaps(b.getTimeslot())))
                .penalize(HardMediumSoftScore.ONE_HARD)
                .justifyWith((a, b, score) -> Explanation.of(
                        a.getLabel() + " and " + b.getLabel() + " overlap; both are taken by " + a.sharedCohort(b), a, b))
                .asConstraint(COHORT_OVERLAP);
    }

    Constraint roomTooSmall(ConstraintFactory f) {
        return f.forEach(Section.class)
                .filter(s -> s.getRoom().getCapacity() < s.getEnrollmentCap())
                .penalize(HardMediumSoftScore.ONE_HARD,
                        s -> 1 + (s.getEnrollmentCap() - s.getRoom().getCapacity()) / 10)
                .justifyWith((s, score) -> Explanation.of(
                        s.getLabel() + " caps at " + s.getEnrollmentCap() + " but " + s.getRoom().getLabel()
                                + " seats " + s.getRoom().getCapacity(), s))
                .asConstraint(ROOM_TOO_SMALL);
    }

    Constraint missingEquipment(ConstraintFactory f) {
        return f.forEach(Section.class)
                .filter(s -> !s.getRoom().hasAll(s.getRequiredFeatures()))
                .penalize(HardMediumSoftScore.ONE_HARD)
                .justifyWith((s, score) -> Explanation.of(
                        s.getLabel() + " needs " + String.join(", ", s.getRequiredFeatures()).replace('_', ' ')
                                + "; " + s.getRoom().getLabel() + " doesn't have it", s))
                .asConstraint(MISSING_EQUIPMENT);
    }

    Constraint wrongPattern(ConstraintFactory f) {
        return f.forEach(Section.class)
                .filter(s -> !s.getAllowedFamilies().contains(s.getTimeslot().getFamily()))
                .penalize(HardMediumSoftScore.ONE_HARD)
                .justifyWith((s, score) -> Explanation.of(
                        s.getLabel() + " can't meet " + s.getTimeslot().getFamily(), s))
                .asConstraint(WRONG_PATTERN);
    }

    Constraint instructorUnavailable(ConstraintFactory f) {
        return f.forEach(Section.class)
                .join(Availability.class,
                        equal(Section::getInstructorId, Availability::instructorId),
                        filtering((s, a) -> a.preference() == Availability.Preference.UNAVAILABLE && a.overlaps(s.getTimeslot())))
                .penalize(HardMediumSoftScore.ONE_HARD)
                .justifyWith((s, a, score) -> Explanation.of(
                        s.getInstructorName() + " is unavailable " + a.day() + " " + a.start() + "-" + a.end()
                                + " (" + s.getLabel() + ")", s))
                .asConstraint(INSTRUCTOR_UNAVAILABLE);
    }

    /* ---------------- Medium ---------------- */

    Constraint notPlaced(ConstraintFactory f) {
        return f.forEachIncludingUnassigned(Section.class)
                .filter(s -> s.getTimeslot() == null || s.getRoom() == null)
                .penalize(HardMediumSoftScore.ONE_MEDIUM)
                .justifyWith((s, score) -> Explanation.of(s.getLabel() + " has no " +
                        (s.getTimeslot() == null ? (s.getRoom() == null ? "time or room" : "time") : "room"), s))
                .asConstraint(NOT_PLACED);
    }

    /* ---------------- Soft ---------------- */

    Constraint undesiredTime(ConstraintFactory f) {
        return f.forEach(Section.class)
                .join(Availability.class,
                        equal(Section::getInstructorId, Availability::instructorId),
                        filtering((s, a) -> a.preference() == Availability.Preference.UNDESIRED && a.overlaps(s.getTimeslot())))
                .penalize(HardMediumSoftScore.ofSoft(10))
                .justifyWith((s, a, score) -> Explanation.of(
                        s.getInstructorName() + " would rather not teach " + s.getLabel() + " at " + s.getTimeslot().label(), s))
                .asConstraint(UNDESIRED_TIME);
    }

    Constraint preferredTime(ConstraintFactory f) {
        return f.forEach(Section.class)
                .join(Availability.class,
                        equal(Section::getInstructorId, Availability::instructorId),
                        filtering((s, a) -> a.preference() == Availability.Preference.PREFERRED && a.overlaps(s.getTimeslot())))
                .reward(HardMediumSoftScore.ofSoft(5))
                .justifyWith((s, a, score) -> Explanation.of(
                        s.getLabel() + " is in " + s.getInstructorName() + "'s preferred time", s))
                .asConstraint(PREFERRED_TIME);
    }

    Constraint emptySeats(ConstraintFactory f) {
        return f.forEach(Section.class)
                .filter(s -> s.getRoom().getCapacity() > s.getEnrollmentCap())
                .penalize(HardMediumSoftScore.ONE_SOFT, s -> (s.getRoom().getCapacity() - s.getEnrollmentCap()) / 10)
                .justifyWith((s, score) -> Explanation.of(
                        s.getLabel() + " (" + s.getEnrollmentCap() + ") in " + s.getRoom().getLabel()
                                + " (" + s.getRoom().getCapacity() + " seats)", s))
                .asConstraint(EMPTY_SEATS);
    }

    Constraint earlyOrLate(ConstraintFactory f) {
        return f.forEach(Section.class)
                .filter(s -> s.getTimeslot().getStart().isBefore(EARLY) || !s.getTimeslot().getStart().isBefore(LATE))
                .penalize(HardMediumSoftScore.ofSoft(3))
                .justifyWith((s, score) -> Explanation.of(s.getLabel() + " starts at " + s.getTimeslot().getStart(), s))
                .asConstraint(EARLY_OR_LATE);
    }

    Constraint buildingChange(ConstraintFactory f) {
        return f.forEachUniquePair(Section.class,
                        equal(Section::getInstructorId),
                        filtering((a, b) -> a.getInstructorId() != null
                                && a.getTimeslot().sharesDay(b.getTimeslot())
                                && !a.getRoom().getBuilding().equals(b.getRoom().getBuilding())
                                && a.getTimeslot().gapMinutes(b.getTimeslot()) >= 0
                                && a.getTimeslot().gapMinutes(b.getTimeslot()) < 30))
                .penalize(HardMediumSoftScore.ofSoft(3))
                .justifyWith((a, b, score) -> Explanation.of(
                        a.getInstructorName() + " goes from " + a.getRoom().getBuilding() + " to "
                                + b.getRoom().getBuilding() + " with under 30 minutes between classes", a, b))
                .asConstraint(BUILDING_CHANGE);
    }

    /** "CHEM 151L-002" -> "CHEM 151L". Sections of the same course never share students. */
    private static String courseOf(Section s) {
        String label = s.getLabel();
        int dash = label.lastIndexOf('-');
        return dash > 0 ? label.substring(0, dash) : label;
    }
}
