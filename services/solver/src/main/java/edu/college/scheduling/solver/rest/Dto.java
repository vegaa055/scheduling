package edu.college.scheduling.solver.rest;

import java.util.List;

/** Wire format shared with the Node API (apps/api/src/solver/client.ts). Times are "HH:mm". */
public final class Dto {
    private Dto() {}

    public record TimeslotIn(String id, String family, List<String> days, String start, String end) {}

    public record RoomIn(String id, String label, String building, int capacity, List<String> features) {}

    public record SectionIn(String id, String label, String instructorId, String instructorName, int enrollmentCap,
                            List<String> allowedFamilies, List<String> requiredFeatures, List<String> cohorts,
                            boolean pinned, String timeslotId, String roomId) {}

    public record AvailabilityIn(String instructorId, String day, String start, String end, String preference) {}

    public record ProblemIn(String name, List<TimeslotIn> timeslots, List<RoomIn> rooms, List<SectionIn> sections,
                            List<AvailabilityIn> availability) {}

    public record Assignment(String sectionId, String timeslotId, String roomId) {}

    public record SolutionOut(String jobId, String status, String score, Long hard, Long medium, Long soft,
                              List<Assignment> assignments, String error) {}

    public record ConstraintOut(String name, String score, int matchCount, List<String> justifications) {}

    public record AnalysisOut(String score, List<ConstraintOut> constraints) {}

    public record JobCreated(String jobId) {}
}
