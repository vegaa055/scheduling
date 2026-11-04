FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/solver-*.jar app.jar
EXPOSE 8095
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:8095/actuator/health || exit 1
ENTRYPOINT ["java", "-XX:+UseG1GC", "-jar", "/app/app.jar"]
