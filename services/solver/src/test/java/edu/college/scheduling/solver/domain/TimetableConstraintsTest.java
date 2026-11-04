package edu.college.scheduling.solver.domain;

import ai.timefold.solver.core.api.score.stream.test.ConstraintVerifier;
import edu.college.scheduling.solver.domain.Availability;
import edu.college.scheduling.solver.domain.Room;
import edu.college.scheduling.solver.domain.Section;
import edu.college.scheduling.solver.domain.Timeslot;
import edu.college.scheduling.solver.domain.Timetable;
import edu.college.scheduling.solver.domain.TimetableConstraints;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TimetableConstraintsTest {

    private final ConstraintVerifier<TimetableConstraints, Timetable> verifier =
            ConstraintVerifier.build(new TimetableConstraints(), Timetable.class, Section.class);

    private static final Timeslot MWF9 = new Timeslot("t1", "MWF50", List.of("MO", "WE", "FR"), LocalTime.of(9, 0), LocalTime.of(9, 50));
    private static final Timeslot TR930 = new Timeslot("t2", "TR75", List.of("TU", "TH"), LocalTime.of(9, 30), LocalTime.of(10, 45));
    private static final Timeslot M_LAB = new Timeslot("t3", "LAB170", List.of("MO"), LocalTime.of(8, 0), LocalTime.of(10, 50));
    private static final Room HALL = new Room("r1", "CHM 111", "CHM", 240, Set.of("projector"));
    private static final Room LAB = new Room("r2", "CHM 201", "CHM", 24, Set.of("wet_lab"));

    private static Section section(String id, String label, String instructor, int cap, Timeslot t, Room r, Set<String> cohorts) {
        return new Section(id, label, instructor, instructor, cap, Set.of("MWF50", "TR75", "LAB170"), Set.of(), cohorts, false, t, r);
    }

    @Test
    void roomDoubleBooked() {
        verifier.verifyThat(TimetableConstraints::roomDoubleBooked)
                .given(section("a", "CHEM 151-001", "x", 100, MWF9, HALL, Set.of()),
                       section("b", "PHYS 141-001", "y", 100, M_LAB, HALL, Set.of()))
                .penalizesBy(1);
    }

    @Test
    void differentDaysDoNotClash() {
        verifier.verifyThat(TimetableConstraints::roomDoubleBooked)
                .given(section("a", "CHEM 151-001", "x", 100, MWF9, HALL, Set.of()),
                       section("b", "PHYS 141-001", "y", 100, TR930, HALL, Set.of()))
                .penalizesBy(0);
    }

    @Test
    void instructorDoubleBooked() {
        verifier.verifyThat(TimetableConstraints::instructorDoubleBooked)
                .given(section("a", "CHEM 151-001", "chen", 100, MWF9, HALL, Set.of()),
                       section("b", "CHEM 151L-001", "chen", 20, M_LAB, LAB, Set.of()))
                .penalizesBy(1);
    }

    @Test
    void cohortOverlapIgnoresSectionsOfTheSameCourse() {
        verifier.verifyThat(TimetableConstraints::cohortOverlap)
                .given(section("a", "MATH 125-001", "x", 40, MWF9, HALL, Set.of("y1")),
                       section("b", "MATH 125-002", "y", 40, MWF9, LAB, Set.of("y1")),
                       section("c", "CHEM 151-001", "z", 40, MWF9, HALL, Set.of("y1")))
                .penalizesBy(2);
    }

    @Test
    void roomTooSmallIsWeightedByShortfall() {
        verifier.verifyThat(TimetableConstraints::roomTooSmall)
                .given(section("a", "CHEM 151-001", "x", 60, MWF9, LAB, Set.of()))
                .penalizesBy(1 + (60 - 24) / 10);
    }

    @Test
    void unavailableInstructor() {
        verifier.verifyThat(TimetableConstraints::instructorUnavailable)
                .given(section("a", "CHEM 151-001", "chen", 100, TR930, HALL, Set.of()),
                       new Availability("chen", "TU", LocalTime.of(8, 0), LocalTime.of(12, 0), Availability.Preference.UNAVAILABLE))
                .penalizesBy(1);
    }

    @Test
    void unplacedSection() {
        verifier.verifyThat(TimetableConstraints::notPlaced)
                .given(section("a", "CHEM 151-001", "x", 100, null, null, Set.of()))
                .penalizesBy(1);
    }
}
