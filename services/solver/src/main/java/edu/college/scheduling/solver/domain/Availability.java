package edu.college.scheduling.solver.domain;

import java.time.LocalTime;

/** An instructor's declared availability for part of a weekday. Problem fact. */
public record Availability(String instructorId, String day, LocalTime start, LocalTime end, Preference preference) {

    public enum Preference { UNAVAILABLE, UNDESIRED, PREFERRED }

    public boolean overlaps(Timeslot t) {
        return t.meetsOn(day) && t.getStart().isBefore(end) && start.isBefore(t.getEnd());
    }
}
