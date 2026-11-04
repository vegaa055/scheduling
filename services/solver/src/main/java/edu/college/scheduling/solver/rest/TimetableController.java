package edu.college.scheduling.solver.rest;

import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.solver.SolverConfigOverride;
import ai.timefold.solver.core.api.solver.SolverManager;
import ai.timefold.solver.core.api.solver.SolverStatus;
import ai.timefold.solver.core.config.solver.termination.TerminationConfig;
import edu.college.scheduling.solver.domain.Availability;
import edu.college.scheduling.solver.domain.ScoreReport;
import edu.college.scheduling.solver.domain.Room;
import edu.college.scheduling.solver.domain.Section;
import edu.college.scheduling.solver.domain.Timeslot;
import edu.college.scheduling.solver.domain.Timetable;
import java.time.Duration;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Asynchronous solving API. The Node API submits a term, polls for the best solution so far,
 * and fetches a score analysis when done. Jobs are kept in memory (the API persists results).
 */
@RestController
@RequestMapping("/timetables")
public class TimetableController {
    private static final Logger log = LoggerFactory.getLogger(TimetableController.class);
    private static final int MAX_JOBS = 50;

    private final SolverManager<Timetable> solverManager;
    private final SolutionManager<Timetable, HardMediumSoftScore> solutionManager;

    /** Insertion-ordered so the oldest jobs are evicted first. */
    private final Map<String, Job> jobs = new LinkedHashMap<>();

    private static final class Job {
        volatile Timetable problem;
        volatile Timetable best;
        volatile Throwable error;
    }

    public TimetableController(SolverManager<Timetable> solverManager,
                               SolutionManager<Timetable, HardMediumSoftScore> solutionManager) {
        this.solverManager = solverManager;
        this.solutionManager = solutionManager;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Dto.JobCreated solve(@RequestBody Dto.ProblemIn in, @RequestParam(defaultValue = "30") int secondsLimit) {
        Timetable problem = toDomain(in);
        String jobId = UUID.randomUUID().toString();
        Job job = new Job();
        job.problem = problem;
        job.best = problem;
        synchronized (jobs) {
            jobs.put(jobId, job);
            while (jobs.size() > MAX_JOBS) {
                String oldest = jobs.keySet().iterator().next();
                solverManager.terminateEarly(oldest);
                jobs.remove(oldest);
            }
        }
        int limit = Math.max(5, Math.min(secondsLimit, 900));
        var termination = new TerminationConfig()
                .withSpentLimit(Duration.ofSeconds(limit))
                .withUnimprovedSpentLimit(Duration.ofSeconds(Math.max(5, Math.min(20, limit / 3))));
        solverManager.solveBuilder()
                .withProblemId(jobId)
                .withProblemFinder(id -> job.problem)
                .withBestSolutionEventConsumer(e -> job.best = e.solution())
                .withFinalBestSolutionEventConsumer(e -> job.best = e.solution())
                .withExceptionHandler((id, ex) -> {
                    log.error("Solving job {} failed", id, ex);
                    job.error = ex;
                })
                .withConfigOverride(new SolverConfigOverride().withTerminationConfig(termination))
                .run();
        log.info("Started job {}: {} sections, {} timeslots, {} rooms, {}s limit",
                jobId, problem.getSections().size(), problem.getTimeslots().size(), problem.getRooms().size(), limit);
        return new Dto.JobCreated(jobId);
    }

    @GetMapping("/{jobId}")
    public Dto.SolutionOut get(@PathVariable String jobId) {
        Job job = find(jobId);
        return toOut(jobId, job, solverManager.getSolverStatus(jobId));
    }

    @DeleteMapping("/{jobId}")
    public Dto.SolutionOut stop(@PathVariable String jobId) {
        Job job = find(jobId);
        solverManager.terminateEarly(jobId);
        return toOut(jobId, job, SolverStatus.NOT_SOLVING);
    }

    @GetMapping("/{jobId}/analysis")
    public Dto.AnalysisOut analysis(@PathVariable String jobId) {
        Job job = find(jobId);
        Timetable best = job.best;
        HardMediumSoftScore score = best.getScore() != null ? best.getScore() : solutionManager.update(best);
        return new Dto.AnalysisOut(score.toString(), ScoreReport.explain(best));
    }

    private Job find(String jobId) {
        synchronized (jobs) {
            Job job = jobs.get(jobId);
            if (job == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No such job");
            return job;
        }
    }

    private static Dto.SolutionOut toOut(String jobId, Job job, SolverStatus status) {
        Timetable t = job.best;
        HardMediumSoftScore score = t.getScore();
        List<Dto.Assignment> assignments = t.getSections().stream()
                .map(s -> new Dto.Assignment(s.getId(),
                        s.getTimeslot() == null ? null : s.getTimeslot().getId(),
                        s.getRoom() == null ? null : s.getRoom().getId()))
                .toList();
        return new Dto.SolutionOut(jobId, job.error != null ? "NOT_SOLVING" : status.name(),
                score == null ? null : score.toString(),
                score == null ? null : score.hardScore(),
                score == null ? null : score.mediumScore(),
                score == null ? null : score.softScore(),
                assignments,
                job.error == null ? null : job.error.getMessage());
    }

    static Timetable toDomain(Dto.ProblemIn in) {
        if (in.sections() == null || in.timeslots() == null || in.rooms() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "timeslots, rooms and sections are required");
        }
        List<Timeslot> timeslots = in.timeslots().stream()
                .map(t -> new Timeslot(t.id(), t.family(), t.days(), LocalTime.parse(t.start()), LocalTime.parse(t.end())))
                .toList();
        List<Room> rooms = in.rooms().stream()
                .map(r -> new Room(r.id(), r.label(), r.building(), r.capacity(), new HashSet<>(nz(r.features()))))
                .toList();
        Map<String, Timeslot> tById = timeslots.stream().collect(Collectors.toMap(Timeslot::getId, Function.identity()));
        Map<String, Room> rById = rooms.stream().collect(Collectors.toMap(Room::getId, Function.identity()));
        List<Section> sections = new ArrayList<>();
        for (Dto.SectionIn s : in.sections()) {
            Timeslot t = s.timeslotId() == null ? null : tById.get(s.timeslotId());
            Room r = s.roomId() == null ? null : rById.get(s.roomId());
            // Only pin sections that are fully placed; a half-placed pin would be stuck forever.
            boolean pinned = s.pinned() && t != null && r != null;
            sections.add(new Section(s.id(), s.label(), s.instructorId(), s.instructorName(), s.enrollmentCap(),
                    new HashSet<>(nz(s.allowedFamilies())), new HashSet<>(nz(s.requiredFeatures())),
                    new HashSet<>(nz(s.cohorts())), pinned, pinned ? t : null, pinned ? r : null));
        }
        List<Availability> availability = nz(in.availability()).stream()
                .map(a -> new Availability(a.instructorId(), a.day(), LocalTime.parse(a.start()), LocalTime.parse(a.end()),
                        Availability.Preference.valueOf(a.preference())))
                .toList();
        return new Timetable(in.name(), timeslots, rooms, availability, sections);
    }

    private static <T> List<T> nz(List<T> list) {
        return list == null ? List.of() : list;
    }
}
