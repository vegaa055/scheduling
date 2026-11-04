package edu.college.scheduling.solver.domain;

import ai.timefold.solver.core.api.domain.solution.PlanningEntityCollectionProperty;
import ai.timefold.solver.core.api.domain.solution.PlanningScore;
import ai.timefold.solver.core.api.domain.solution.PlanningSolution;
import ai.timefold.solver.core.api.domain.solution.ProblemFactCollectionProperty;
import ai.timefold.solver.core.api.domain.valuerange.ValueRangeProvider;
import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import java.util.List;

/** One term's timetabling problem and, once solved, its solution. */
@PlanningSolution
public class Timetable {
    private String name;

    @ProblemFactCollectionProperty
    @ValueRangeProvider
    private List<Timeslot> timeslots;

    @ProblemFactCollectionProperty
    @ValueRangeProvider
    private List<Room> rooms;

    @ProblemFactCollectionProperty
    private List<Availability> availability;

    @PlanningEntityCollectionProperty
    private List<Section> sections;

    @PlanningScore
    private HardMediumSoftScore score;

    public Timetable() {}

    public Timetable(String name, List<Timeslot> timeslots, List<Room> rooms, List<Availability> availability,
                     List<Section> sections) {
        this.name = name;
        this.timeslots = timeslots;
        this.rooms = rooms;
        this.availability = availability;
        this.sections = sections;
    }

    public String getName() { return name; }
    public List<Timeslot> getTimeslots() { return timeslots; }
    public List<Room> getRooms() { return rooms; }
    public List<Availability> getAvailability() { return availability; }
    public List<Section> getSections() { return sections; }
    public HardMediumSoftScore getScore() { return score; }
    public void setScore(HardMediumSoftScore score) { this.score = score; }
}
