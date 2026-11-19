## 13. Testing and Build Tools

### Unit testing with JUnit
<!-- level: basic; ref: https://junit.org/junit5/docs/current/user-guide/ -->
JUnit is the standard Java testing framework. JUnit 5 (Jupiter) introduced the modern programming model, and JUnit 6 (2025) continues the same `org.junit.jupiter` API with a Java 17 baseline. Test classes and methods no longer need to be public; you annotate methods with `@Test`, set up state with `@BeforeEach`/`@AfterEach` (or `@BeforeAll`/`@AfterAll` once per class), and assert with `Assertions`.

Useful features:
- `assertThrows` and `assertAll` (groups assertions so all failures are reported).
- `@ParameterizedTest` with `@ValueSource`, `@CsvSource` or `@MethodSource` to run one test against many inputs.
- `@Nested` classes to group scenarios, `@DisplayName` for readable reports.
- `@TempDir` for temporary files, `@Timeout`, `@Disabled`, and tags to select subsets.
- Extensions (`@ExtendWith`) that integrate Mockito, Spring and Testcontainers.

Good unit tests are fast, isolated, deterministic and follow arrange-act-assert. Many teams pair JUnit with AssertJ for fluent assertions.

```java
class PriceCalculatorTest {
    private final PriceCalculator calc = new PriceCalculator(new TaxTable(0.18));

    @Test
    void addsTaxToBasePrice() {
        assertEquals(1180, calc.priceWithTax(1000));
    }

    @ParameterizedTest
    @CsvSource({"0, 0", "100, 118", "999, 1179"})
    void roundsCorrectly(long base, long expected) {
        assertEquals(expected, calc.priceWithTax(base));
    }

    @Test
    void rejectsNegativePrices() {
        var ex = assertThrows(IllegalArgumentException.class, () -> calc.priceWithTax(-1));
        assertTrue(ex.getMessage().contains("negative"));
    }
}
```

- Pitfall: tests depending on execution order, the current time or shared static state become flaky; inject a `Clock`.

### Mocking and integration tests
<!-- level: intermediate; ref: https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html -->
Unit tests isolate the class under test by replacing collaborators with test doubles. Mockito is the dominant library: `mock()` creates a fake that returns defaults, `when(...).thenReturn(...)` stubs behaviour, and `verify(...)` checks interactions. `ArgumentCaptor` captures arguments for detailed assertions. Mockito generates subclasses at runtime with ByteBuddy, so final classes and static methods need the inline mock maker (the default since Mockito 5).

Mocks are powerful but overusing them couples tests to implementation details. Mock at architectural boundaries (HTTP clients, message brokers, clocks), and prefer real objects or simple fakes for value objects and pure logic.

Integration tests verify real wiring: database queries, serialization, HTTP. Testcontainers starts real PostgreSQL, Kafka or Redis in Docker for the duration of the test, which is far more trustworthy than an in-memory database with a different SQL dialect.

```java
@ExtendWith(MockitoExtension.class)
class CheckoutServiceTest {
    @Mock PaymentGateway gateway;
    @Mock OrderRepository orders;
    @InjectMocks CheckoutService service;

    @Test
    void savesOrderWhenPaymentApproved() {
        when(gateway.charge(any(), eq(5000L))).thenReturn(new Approved("tx-1"));

        service.checkout(new Cart("c-1", 5000L));

        var captor = ArgumentCaptor.forClass(Order.class);
        verify(orders).save(captor.capture());
        assertEquals("tx-1", captor.getValue().transactionId());
    }
}
```

- Pitfall: verifying every interaction (`verifyNoMoreInteractions` everywhere) makes refactoring painful.
- Pitfall: mocking types you do not own (for example a third-party SDK's internal classes) gives false confidence; wrap them behind your own interface.

### Maven
<!-- level: basic; ref: https://maven.apache.org/guides/getting-started/index.html -->
Maven is a declarative build tool built on convention over configuration. A `pom.xml` describes the project's coordinates (groupId, artifactId, version), dependencies and plugins; the standard layout (`src/main/java`, `src/test/java`, `src/main/resources`) needs no configuration.

Builds follow a fixed lifecycle of phases: `validate`, `compile`, `test`, `package`, `verify`, `install` (to the local `~/.m2` repository) and `deploy`. Running a phase runs all earlier ones. Plugins bind goals to phases; for example the Surefire plugin runs unit tests in `test` and Failsafe runs integration tests in `verify`.

Dependencies are downloaded from Maven Central with transitive dependencies resolved automatically. Version conflicts are settled by "nearest wins" in the dependency tree, which can surprise you; a BOM (bill of materials) imported in `dependencyManagement` pins consistent versions.

```xml
<properties>
    <maven.compiler.release>21</maven.compiler.release>
</properties>
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.junit</groupId>
            <artifactId>junit-bom</artifactId>
            <version>5.11.4</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
<dependencies>
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

```bash
./mvnw clean verify                    # wrapper pins the Maven version
./mvnw dependency:tree -Dincludes=com.fasterxml.jackson.core
```

- Pitfall: `NoSuchMethodError` at runtime usually means two versions of a library were on the classpath and the wrong one won; inspect `dependency:tree`.

### Gradle
<!-- level: intermediate; ref: https://docs.gradle.org/current/userguide/userguide.html -->
Gradle is a programmable build tool using a Kotlin (`build.gradle.kts`) or Groovy DSL. Instead of a fixed lifecycle it builds a directed acyclic graph of tasks; plugins such as `java`, `application` and `org.springframework.boot` add tasks and conventions. Gradle is the standard for Android and popular for large multi-module JVM builds.

Its main advantages are performance features: incremental builds (tasks whose inputs and outputs have not changed are skipped as up-to-date), a build cache that can be shared across machines and CI, a long-lived daemon, parallel execution and a configuration cache. Toolchains let the build download and use a specific JDK regardless of the one running Gradle.

Dependencies are declared in configurations: `implementation` (on the compile classpath but not leaked to consumers), `api` (exposed to consumers, `java-library` plugin), `compileOnly`, `runtimeOnly` and `testImplementation`. Version catalogs (`gradle/libs.versions.toml`) centralise versions. Conflicts resolve to the highest version by default.

```kotlin
plugins {
    java
    application
}

java {
    toolchain { languageVersion = JavaLanguageVersion.of(25) }
}

dependencies {
    implementation(libs.jackson.databind)
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform() }
application { mainClass = "com.acme.App" }
```

- Use the Gradle wrapper (`./gradlew`) so everyone runs the same version.
- Pitfall: doing expensive work during the configuration phase slows every build, even `./gradlew help`.

## 14. Spring Boot Overview

### Inversion of control and dependency injection
<!-- level: intermediate; ref: https://docs.spring.io/spring-framework/reference/core/beans.html -->
Spring's core is an inversion of control (IoC) container. Instead of objects creating their dependencies with `new`, the container (the `ApplicationContext`) creates objects called beans, wires their dependencies, and manages their lifecycle. Your classes declare what they need; the container decides which implementation to supply.

Beans are discovered by component scanning (`@Component`, `@Service`, `@Repository`, `@Controller`) or declared with `@Bean` methods in `@Configuration` classes. Constructor injection is the recommended style: dependencies become final fields, the object is always fully initialised, and tests can construct it without Spring. With a single constructor no `@Autowired` is needed.

Most beans are singletons (one instance per container), so they must be stateless or thread-safe. Spring also wraps beans in proxies (JDK dynamic proxies or CGLIB subclasses) to add cross-cutting behaviour such as `@Transactional`, `@Cacheable` and `@Async`.

```java
@Service
public class InvoiceService {
    private final InvoiceRepository repository;
    private final Clock clock;

    public InvoiceService(InvoiceRepository repository, Clock clock) {   // constructor injection
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional
    public Invoice issue(Order order) {
        return repository.save(Invoice.from(order, LocalDate.now(clock)));
    }
}

@Configuration
class TimeConfig {
    @Bean Clock clock() { return Clock.systemUTC(); }
}
```

- Pitfall: calling a `@Transactional` method from another method of the same class bypasses the proxy, so no transaction starts.
- Pitfall: circular dependencies are a design smell, and Spring Boot forbids them by default since 2.6.

### Auto-configuration and starters
<!-- level: intermediate; ref: https://docs.spring.io/spring-boot/reference/using/auto-configuration.html -->
Spring Boot builds on Spring Framework to remove boilerplate. Starters are curated dependency bundles (`spring-boot-starter-web`, `-data-jpa`, `-actuator`, `-test`) with versions managed by the Boot parent or BOM, so library versions are tested together.

Auto-configuration inspects the classpath and existing beans and configures sensible defaults: if Jackson is present you get an `ObjectMapper`, if a JDBC driver and the JPA starter are present you get a HikariCP `DataSource`, an `EntityManagerFactory` and a transaction manager. Each auto-configuration class is guarded by conditions such as `@ConditionalOnClass`, `@ConditionalOnMissingBean` and `@ConditionalOnProperty`, so defining your own bean makes Boot back off.

Configuration is externalised in `application.yml`/`properties`, environment variables and command-line arguments, with profiles for environments. `@ConfigurationProperties` binds them to typed, validated records.

```java
@SpringBootApplication          // = @Configuration + @EnableAutoConfiguration + @ComponentScan
public class OrdersApplication {
    public static void main(String[] args) { SpringApplication.run(OrdersApplication.class, args); }
}

@ConfigurationProperties(prefix = "payments")
@Validated
record PaymentProperties(@NotBlank String baseUrl, Duration timeout, int maxRetries) {}
```

```yaml
payments:
  base-url: https://pay.example.com
  timeout: 3s
  max-retries: 2
spring:
  threads:
    virtual:
      enabled: true      # Boot 3.2+ on Java 21+
```

- Debug what was configured with `--debug` (the conditions evaluation report) or the actuator `conditions` endpoint.
- Version note: Spring Boot 3.x requires Java 17+ and Jakarta EE namespaces (`jakarta.*`); Spring Boot 4 (late 2025) builds on Spring Framework 7.

### REST controllers
<!-- level: intermediate; ref: https://docs.spring.io/spring-framework/reference/web/webmvc.html -->
Spring MVC maps HTTP requests to controller methods. `@RestController` combines `@Controller` with `@ResponseBody`, so return values are serialised (usually to JSON via Jackson) rather than rendered as views. Mapping annotations (`@GetMapping`, `@PostMapping`, ...) bind paths and methods; `@PathVariable`, `@RequestParam`, `@RequestHeader` and `@RequestBody` bind inputs; `@Valid` triggers Bean Validation.

Under the hood, the `DispatcherServlet` receives each request, finds a handler, resolves arguments with message converters and returns the response, on a servlet container thread (or a virtual thread when enabled). Spring WebFlux is the reactive alternative on Netty for non-blocking streaming workloads.

Centralise error handling with `@RestControllerAdvice` and return RFC 9457 `ProblemDetail` responses.

```java
@RestController
@RequestMapping("/api/orders")
class OrderController {
    private final OrderService service;
    OrderController(OrderService service) { this.service = service; }

    @GetMapping("/{id}")
    OrderDto get(@PathVariable long id) { return service.find(id); }

    @PostMapping
    ResponseEntity<OrderDto> create(@Valid @RequestBody CreateOrderRequest req) {
        OrderDto created = service.create(req);
        return ResponseEntity.created(URI.create("/api/orders/" + created.id())).body(created);
    }
}

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(OrderNotFoundException.class)
    ProblemDetail notFound(OrderNotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, e.getMessage());
    }
}
```

- Pitfall: returning JPA entities directly leaks internal fields and triggers lazy-loading exceptions; return DTO records.
- Test controllers with `@WebMvcTest` and `MockMvc` for speed.

### Spring Data JPA
<!-- level: intermediate; ref: https://docs.spring.io/spring-data/jpa/reference/ -->
JPA (Jakarta Persistence) is the standard object-relational mapping API, and Hibernate is its most common implementation. Entities are classes annotated with `@Entity` whose fields map to columns; relationships use `@OneToMany`, `@ManyToOne` and similar. A persistence context tracks loaded entities, so changes to managed entities are flushed automatically at commit (dirty checking).

Spring Data JPA removes repository boilerplate: you declare an interface extending `JpaRepository<Entity, Id>` and get CRUD, paging and sorting. Query methods are derived from method names (`findByStatusAndCreatedAtAfter`), or written explicitly with `@Query` in JPQL or native SQL. Projections (interfaces or records) fetch only needed columns.

```java
@Entity
@Table(name = "orders")
class Order {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) Long id;
    String customerId;
    @Enumerated(EnumType.STRING) Status status;
    @OneToMany(mappedBy = "order", fetch = FetchType.LAZY) List<OrderLine> lines = new ArrayList<>();
}

interface OrderRepository extends JpaRepository<Order, Long> {
    List<Order> findByCustomerIdAndStatus(String customerId, Status status);

    @Query("select o from Order o join fetch o.lines where o.id = :id")
    Optional<Order> findWithLines(long id);                 // avoids N+1

    record Summary(Long id, Status status) {}
    List<Summary> findByStatus(Status status);               // projection
}
```

- The N+1 query problem (one query for orders plus one per order for its lines) is the top JPA performance issue; detect it with SQL logging and fix with fetch joins, `@EntityGraph` or batch fetching.
- Pitfall: `FetchType.EAGER` on collections loads huge graphs; keep associations lazy and fetch explicitly.
- Pitfall: `@Enumerated(ORDINAL)` (the default) breaks when enum order changes; use `STRING`.

### Actuator, observability and production readiness
<!-- level: intermediate; ref: https://docs.spring.io/spring-boot/reference/actuator/index.html -->
Spring Boot Actuator adds production endpoints under `/actuator`: `health` (with liveness and readiness groups for Kubernetes probes), `info`, `metrics`, `prometheus`, `env`, `loggers` (change log levels at runtime), `threaddump` and `heapdump`. Expose only what you need, and secure the rest, since `env` and `heapdump` can leak secrets.

Metrics are recorded through Micrometer, a vendor-neutral facade that exports to Prometheus, Datadog, CloudWatch and others. Boot auto-instruments HTTP requests, JVM memory and GC, connection pools and executors. Micrometer Observation and Tracing add distributed tracing (OpenTelemetry), propagating trace ids across services and into logs.

Other production essentials: graceful shutdown (`server.shutdown=graceful`) to finish in-flight requests, sensible timeouts on every client, structured JSON logging (built in since Boot 3.4), and container-friendly JVM settings.

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  endpoint:
    health:
      probes:
        enabled: true
server:
  shutdown: graceful
```

```java
@Component
class CheckoutMetrics {
    private final Counter failures;
    CheckoutMetrics(MeterRegistry registry) {
        failures = Counter.builder("checkout.failures").tag("reason", "payment").register(registry);
    }
    void paymentFailed() { failures.increment(); }
}
```

- Pitfall: a readiness probe that checks downstream dependencies can take the whole fleet out when one dependency blips; keep liveness checks local.
- Interview tip: be ready to describe the RED metrics (rate, errors, duration) for every endpoint.
