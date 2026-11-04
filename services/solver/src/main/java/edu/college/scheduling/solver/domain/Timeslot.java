package edu.college.scheduling.solver.domain;

import java.time.Duration;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;

/** A standard meeting pattern, e.g. MWF 9:00-9:50. Problem fact. */
public class Timeslot {
    private static final Map<String, Integer> DAY_BIT =
            Map.of("MO", 1, "TU", 2, "WE", 4, "TH", 8, "FR", 16, "SA", 32, "SU", 64);
    private static final Map<String, String> DAY_LETTER =
            Map.of("MO", "M", "TU", "T", "WE", "W", "TH", "R", "FR", "F", "SA", "S", "SU", "U");

    private String id;
    private String family;
    private List<String> days;
    private LocalTime start;
    private LocalTime end;
    private int dayMask;

    public Timeslot() {}

    public Timeslot(String id, String family, List<String> days, LocalTime start, LocalTime end) {
        this.id = id;
        this.family = family;
        this.days = days;
        this.start = start;
        this.end = end;
        this.dayMask = days.stream().mapToInt(d -> DAY_BIT.getOrDefault(d, 0)).reduce(0, (a, b) -> a | b);
    }

    /** True when the two patterns share a weekday and their times overlap. */
    public boolean overlaps(Timeslot other) {
        return sharesDay(other) && start.isBefore(other.end) && other.start.isBefore(end);
    }

    public boolean sharesDay(Timeslot other) {
        return (dayMask & other.dayMask) != 0;
    }

    public boolean meetsOn(String day) {
        return (dayMask & DAY_BIT.getOrDefault(day, 0)) != 0;
    }

    /** Minutes between the two patterns on a shared day; -1 when they overlap. */
    public long gapMinutes(Timeslot other) {
        if (!end.isAfter(other.start)) return Duration.between(end, other.start).toMinutes();
        if (!other.end.isAfter(start)) return Duration.between(other.end, start).toMinutes();
        return -1;
    }

    public String label() {
        StringBuilder sb = new StringBuilder();
        for (String d : days) sb.append(DAY_LETTER.getOrDefault(d, d));
        return sb + " " + start + "-" + end;
    }

    public String getId() { return id; }
    public String getFamily() { return family; }
    public List<String> getDays() { return days; }
    public LocalTime getStart() { return start; }
    public LocalTime getEnd() { return end; }

    @Override
    public String toString() { return label(); }
}
