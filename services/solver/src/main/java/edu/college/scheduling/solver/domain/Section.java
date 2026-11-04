package edu.college.scheduling.solver.domain;

import ai.timefold.solver.core.api.domain.common.PlanningId;
import ai.timefold.solver.core.api.domain.entity.PlanningEntity;
import ai.timefold.solver.core.api.domain.entity.PlanningPin;
import ai.timefold.solver.core.api.domain.variable.PlanningVariable;
import java.util.Set;

/**
 * A course section to be placed. The solver chooses its meeting pattern (timeslot) and room.
 * Either may stay unassigned when the term is over-constrained; that costs a medium-level
 * penalty, so the solver places as many sections as it can without breaking hard rules.
 */
@PlanningEntity
public class Section {
    @PlanningId
    private String id;
    private String label;
    private String instructorId;
    private String instructorName;
    private int enrollmentCap;
    private Set<String> allowedFamilies;
    private Set<String> requiredFeatures;
    private Set<String> cohorts;

    /** Locked by a scheduler: the solver keeps the current assignment. */
    @PlanningPin
    private boolean pinned;

    @PlanningVariable(allowsUnassigned = true)
    private Timeslot timeslot;

    @PlanningVariable(allowsUnassigned = true)
    private Room room;

    public Section() {}

    public Section(String id, String label, String instructorId, String instructorName, int enrollmentCap,
                   Set<String> allowedFamilies, Set<String> requiredFeatures, Set<String> cohorts,
                   boolean pinned, Timeslot timeslot, Room room) {
        this.id = id;
        this.label = label;
        this.instructorId = instructorId;
        this.instructorName = instructorName;
        this.enrollmentCap = enrollmentCap;
        this.allowedFamilies = allowedFamilies;
        this.requiredFeatures = requiredFeatures;
        this.cohorts = cohorts;
        this.pinned = pinned;
        this.timeslot = timeslot;
        this.room = room;
    }

    public String sharedCohort(Section other) {
        for (String c : cohorts) if (other.cohorts.contains(c)) return c;
        return null;
    }

    public boolean sharesCohortWith(Section other) {
        return sharedCohort(other) != null;
    }

    public String getId() { return id; }
    public String getLabel() { return label; }
    public String getInstructorId() { return instructorId; }
    public String getInstructorName() { return instructorName; }
    public int getEnrollmentCap() { return enrollmentCap; }
    public Set<String> getAllowedFamilies() { return allowedFamilies; }
    public Set<String> getRequiredFeatures() { return requiredFeatures; }
    public Set<String> getCohorts() { return cohorts; }
    public boolean isPinned() { return pinned; }
    public Timeslot getTimeslot() { return timeslot; }
    public void setTimeslot(Timeslot timeslot) { this.timeslot = timeslot; }
    public Room getRoom() { return room; }
    public void setRoom(Room room) { this.room = room; }

    @Override
    public String toString() { return label; }
}
