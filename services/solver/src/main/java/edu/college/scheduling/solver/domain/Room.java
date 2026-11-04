package edu.college.scheduling.solver.domain;

import java.util.Set;

/** A schedulable teaching space. Problem fact. */
public class Room {
    private String id;
    private String label;
    private String building;
    private int capacity;
    private Set<String> features;

    public Room() {}

    public Room(String id, String label, String building, int capacity, Set<String> features) {
        this.id = id;
        this.label = label;
        this.building = building;
        this.capacity = capacity;
        this.features = features;
    }

    public boolean hasAll(Set<String> required) {
        return features.containsAll(required);
    }

    public String getId() { return id; }
    public String getLabel() { return label; }
    public String getBuilding() { return building; }
    public int getCapacity() { return capacity; }
    public Set<String> getFeatures() { return features; }

    @Override
    public String toString() { return label; }
}
