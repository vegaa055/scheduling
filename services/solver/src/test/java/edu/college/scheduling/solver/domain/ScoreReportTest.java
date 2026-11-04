package edu.college.scheduling.solver.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.solver.SolverFactory;
import ai.timefold.solver.core.config.solver.SolverConfig;
import edu.college.scheduling.solver.rest.Dto;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The review report must add up to exactly the score Timefold calculates. */
class ScoreReportTest {

    private final SolutionManager<Timetable, HardMediumSoftScore> solutionManager = SolutionManager.create(
            SolverFactory.create(new SolverConfig()
                    .withSolutionClass(Timetable.class)
                    .withEntityClasses(Section.class)
                    .withConstraintProviderClass(TimetableConstraints.class)));

    @Test
    void reportMatchesSolverScore() {
        Timeslot mwf8 = new Timeslot("t1", "MWF50", List.of("MO", "WE", "FR"), LocalTime.of(8, 0), LocalTime.of(8, 50));
        Timeslot mwf9 = new Timeslot("t2", "MWF50", List.of("MO", "WE", "FR"), LocalTime.of(9, 0), LocalTime.of(9, 50));
        Timeslot tr = new Timeslot("t3", "TR75", List.of("TU", "TH"), LocalTime.of(9, 30), LocalTime.of(10, 45));
        Room hall = new Room("r1", "CHM 111", "CHM", 240, Set.of("projector"));
        Room small = new Room("r2", "MTH 301", "MTH", 35, Set.of());
        Room lab = new Room("r3", "CHM 201", "CHM", 24, Set.of("wet_lab"));
        Set<String> lecture = Set.of("MWF50", "TR75");

        List<Section> sections = List.of(
                // double-booked room + same cohort
                new Section("a", "CHEM 151-001", "chen", "D. Chen", 200, lecture, Set.of(), Set.of("y1"), false, mwf8, hall),
                new Section("b", "MATH 125-001", "kim", "R. Kim", 45, lecture, Set.of(), Set.of("y1"), false, mwf8, hall),
                // too small, early, building change for chen, undesired time
                new Section("c", "CHEM 241A-001", "chen", "D. Chen", 60, lecture, Set.of(), Set.of(), false, mwf9, small),
                // wrong pattern + missing equipment + unavailable instructor
                new Section("d", "CHEM 151L-001", "patel", "J. Patel", 20, Set.of("LAB170"), Set.of("wet_lab"), Set.of(), false, tr, small),
                // preferred time, fine room
                new Section("e", "MATH 313-001", "grant", "E. Grant", 30, lecture, Set.of(), Set.of(), false, tr, lab),
                // unplaced
                new Section("f", "PHYS 241-001", "wu", "C. Wu", 40, lecture, Set.of(), Set.of(), false, null, null));
        List<Availability> availability = List.of(
                new Availability("patel", "TU", LocalTime.of(8, 0), LocalTime.of(12, 0), Availability.Preference.UNAVAILABLE),
                new Availability("chen", "MO", LocalTime.of(9, 0), LocalTime.of(10, 0), Availability.Preference.UNDESIRED),
                new Availability("grant", "TH", LocalTime.of(9, 0), LocalTime.of(11, 0), Availability.Preference.PREFERRED));
        Timetable t = new Timetable("test", List.of(mwf8, mwf9, tr), List.of(hall, small, lab), availability, sections);

        HardMediumSoftScore solverScore = solutionManager.update(t);
        List<Dto.ConstraintOut> report = ScoreReport.explain(t);

        long hard = 0, medium = 0, soft = 0;
        for (Dto.ConstraintOut c : report) {
            HardMediumSoftScore s = HardMediumSoftScore.parseScore(c.score());
            hard += s.hardScore();
            medium += s.mediumScore();
            soft += s.softScore();
        }
        assertTrue(solverScore.hardScore() < 0, "fixture should be infeasible");
        assertEquals(solverScore, HardMediumSoftScore.of(hard, medium, soft), () -> "report " + report);
    }
}
