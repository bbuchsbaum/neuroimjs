# Display Components Refactoring Plan

## Overview
This document outlines the incremental refactoring plan for the neuroimjs display components. Each phase includes specific checkpoints where all tests must pass before proceeding.

## Current Issues Summary

### Critical Issues
1. **Memory Leaks**
   - OrthogonalImageViewer: Disposers array grows without bounds
   - VolLayer: Unbounded cache growth
   - No sprite/container pooling in ImageLayer

2. **Performance Problems**
   - ImageLayer creates new sprites on every render
   - No texture atlases or WebGL optimization
   - Inefficient color mapping in ColorMap

3. **Architecture Issues**
   - Tight coupling between components
   - Mixed responsibilities (SliceViewer manages too much)
   - Complex state synchronization with potential infinite loops

4. **Code Quality**
   - ColorMap range detection hack (lines 174-213)
   - Missing error handling and validation
   - Console logging in production code

## Implementation Phases

### Phase 1: Foundation & Safety (Week 1)

#### Checkpoint 1.1: Add Missing Tests
**Goal**: Establish comprehensive test coverage before refactoring

**Tasks**:
1. Create test file: `tests/display/OrthogonalImageViewer.test.ts`
2. Create test file: `tests/display/SliceViewer.test.ts`
3. Create test file: `tests/display/SliceView.test.ts`
4. Create test file: `tests/display/ImageLayer.test.ts`
5. Create test file: `tests/display/ColorMap.test.ts`

**Success Criteria**:
- All new tests pass
- Coverage > 90% for display components
- All existing tests continue to pass

#### Checkpoint 1.2: Fix Critical Memory Leaks
**Goal**: Prevent memory growth in long-running applications

**Tasks**:
1. Fix OrthogonalImageViewer disposers array
   - Implement proper cleanup in setupViewerReactions
   - Add WeakMap for event handlers
2. Fix unbounded cache in VolLayer
   - Add maxCacheSize parameter
   - Implement cache eviction
3. Add memory leak tests

**Success Criteria**:
- Memory usage stable over 1000 operations
- All disposers properly cleaned up
- Tests verify no memory growth

### Phase 2: Performance Optimizations (Week 2)

#### Checkpoint 2.1: Implement Object Pooling
**Goal**: Reduce GC pressure and improve rendering performance

**Tasks**:
1. Create `SpritePool` class
2. Create `ContainerPool` class
3. Modify ImageLayer to use pools
4. Add pool size configuration
5. Create performance benchmarks

**Success Criteria**:
- 50% reduction in object allocations
- Performance tests show improvement
- No visual artifacts

#### Checkpoint 2.2: Add LRU Cache
**Goal**: Bounded memory usage with optimal cache performance

**Tasks**:
1. Create `LRUCache` class with tests
2. Replace VolLayer cache with LRU
3. Add cache metrics (hit/miss ratio)
4. Make cache size configurable
5. Add cache performance tests

**Success Criteria**:
- Memory usage bounded
- Cache hit ratio > 80% in typical usage
- All tests pass

### Phase 3: Architecture Improvements (Week 3)

#### Checkpoint 3.1: Refactor ColorMap
**Goal**: Remove hacks and improve maintainability

**Tasks**:
1. Remove range detection hack (lines 174-213)
2. Implement proper range validation
3. Remove all console.log statements
4. Add ColorMapFactory pattern
5. Optimize fillImageData with lookup tables

**Success Criteria**:
- No arbitrary thresholds in code
- 2x performance improvement in fillImageData
- Clean, testable code

#### Checkpoint 3.2: Decouple Components
**Goal**: Improve testability and reusability

**Tasks**:
1. Extract interfaces:
   - `ISliceModel`
   - `ISliceView`
   - `ISliceController`
2. Implement dependency injection in SliceViewer
3. Create ViewerFactory
4. Update all imports to use interfaces

**Success Criteria**:
- Components can be mocked for testing
- No circular dependencies
- All integration tests pass

### Phase 4: State Management (Week 4)

#### Checkpoint 4.1: Simplify State Synchronization
**Goal**: Prevent infinite loops and simplify debugging

**Tasks**:
1. Design event-based architecture
2. Replace MobX reactions with EventBus
3. Implement single source of truth
4. Add state validation
5. Create state flow diagram

**Success Criteria**:
- No infinite update loops possible
- State changes traceable
- Reduced complexity

#### Checkpoint 4.2: Add Error Boundaries
**Goal**: Graceful error handling and recovery

**Tasks**:
1. Implement error boundary for each component
2. Add fallback UI components
3. Create error recovery strategies
4. Add error logging
5. Test error scenarios

**Success Criteria**:
- Errors don't crash entire viewer
- User-friendly error messages
- Automatic recovery where possible

### Phase 5: API Refinement (Week 5)

#### Checkpoint 5.1: Create Public API
**Goal**: Stable, documented public interface

**Tasks**:
1. Define public API surface
2. Hide internal implementation
3. Add comprehensive JSDoc
4. Create TypeScript declarations
5. Add API stability tests

**Success Criteria**:
- Clear separation of public/private
- 100% API documentation
- Backward compatibility maintained

#### Checkpoint 5.2: Documentation & Examples
**Goal**: Enable easy adoption and usage

**Tasks**:
1. Update component documentation
2. Create usage examples
3. Add migration guide
4. Create interactive demos
5. Update README

**Success Criteria**:
- All features documented
- Working examples for common use cases
- Clear migration path

## Testing Strategy

### Test Execution
- Run `npm test` after every change
- Use `npm run test:watch` during development
- Run `npm run test:types` for TypeScript checks

### Test Requirements
- Write tests BEFORE refactoring
- Maintain > 90% code coverage
- Include edge cases and error scenarios
- Performance tests for critical paths

### Test Categories
1. **Unit Tests**: Individual component behavior
2. **Integration Tests**: Component interactions
3. **Performance Tests**: Rendering and memory usage
4. **Visual Tests**: Screenshot comparisons

## Implementation Guidelines

### Git Workflow
1. Create feature branch: `git checkout -b refactor/display-components`
2. Commit after each checkpoint
3. Create PR after each phase
4. Merge only when all tests pass

### Code Standards
- No `any` types without justification
- All public methods documented
- Error messages helpful and actionable
- Performance metrics logged

### Review Process
- Self-review checklist before PR
- Performance comparison required
- Breaking changes documented
- Migration guide updated

## Success Metrics

### Performance
- Memory usage reduced by 30%
- Render time improved by 50%
- Cache hit ratio > 80%

### Quality
- Zero console.log in production
- Test coverage > 90%
- No TypeScript errors
- All linting rules pass

### Maintainability
- Cyclomatic complexity < 10
- No circular dependencies
- Clear component boundaries
- Comprehensive documentation

## Risk Mitigation

### Backward Compatibility
- Maintain existing public API
- Deprecate before removing
- Provide migration utilities
- Version appropriately

### Performance Regression
- Benchmark before/after each phase
- Profile memory usage
- Monitor render performance
- Rollback plan ready

### Testing Gaps
- Review test coverage reports
- Add tests for reported bugs
- Include edge cases
- Test on multiple browsers

## Timeline

- **Week 1**: Foundation & Safety
- **Week 2**: Performance Optimizations  
- **Week 3**: Architecture Improvements
- **Week 4**: State Management
- **Week 5**: API Refinement
- **Week 6**: Buffer for issues & polish

## Next Steps

1. Review and approve this plan
2. Set up performance benchmarks
3. Create feature branch
4. Begin Phase 1.1: Add missing tests

## Appendix: File Locations

### Components to Refactor
- `/src/display/OrthogonalImageViewer.ts`
- `/src/display/SliceViewer.ts`
- `/src/display/SliceView.ts`
- `/src/display/SliceModel.ts`
- `/src/display/SliceController.ts`
- `/src/display/ImageLayer.ts`
- `/src/display/VolLayer.ts`
- `/src/display/ColorMap.ts`
- `/src/display/CoordinateTransformer.ts`
- `/src/display/SliceTransform.ts`

### Test Files to Create
- `/tests/display/OrthogonalImageViewer.test.ts`
- `/tests/display/SliceViewer.test.ts`
- `/tests/display/SliceView.test.ts`
- `/tests/display/ImageLayer.test.ts`
- `/tests/display/ColorMap.test.ts`