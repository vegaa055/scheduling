package edu.college.scheduling.solver.domain;

import ai.timefold.solver.core.api.score.stream.ConstraintJustification;
import java.util.Arrays;
import java.util.List;

/** Human-readable reason for a constraint match, shown to schedulers in the UI. */
public record Explanation(String text, List<String> sectionIds) implements ConstraintJustification {
    public static Explanation of(String text, Section... sections) {
        return new Explanation(text, Arrays.stream(sections).map(Section::getId).toList());
    }
}
