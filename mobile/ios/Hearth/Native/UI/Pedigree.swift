import SwiftUI

typealias PedigreeNode = Inheritance.PedigreeNode

/// A parent→child line: its colour and weight, dashed or not, and the text drawn on its middle.
struct PedigreeEdge {
    let from: PedigreeNode
    let to: PedigreeNode
    var color: Color?
    var width: CGFloat = 1.2
    var dashed = false
    var label: String?
    var labelColor: Color?

    /// Parent→child pairs of a layout, skipping parents that are not in it.
    static func of(_ nodes: [PedigreeNode]) -> [PedigreeEdge] {
        var byId: [String: PedigreeNode] = [:]
        for n in nodes { byId[n.person.id] = n }
        return nodes.flatMap { to in
            to.parents.compactMap { pid in byId[pid].map { PedigreeEdge(from: $0, to: to) } }
        }
    }
}

/// Generation by generation, one slot per person, a line from every parent to every child
/// (Pedigree.tsx, with the same geometry). Callers draw each box and style the lines, so the family
/// tree and the per-rsid inheritance tree line up the same way. Scrolls sideways when wide.
struct Pedigree<Node: View>: View {
    let nodes: [PedigreeNode]
    let edges: [PedigreeEdge]
    @ViewBuilder let node: (PedigreeNode) -> Node

    static var nodeWidth: CGFloat { 150 }
    static var nodeHeight: CGFloat { 62 }
    private static var gapX: CGFloat { 40 }
    private static var gapY: CGFloat { 90 }

    private func x(_ column: Int) -> CGFloat { (Self.nodeWidth + Self.gapX) * CGFloat(column) + Self.gapX / 2 }
    private func y(_ generation: Int) -> CGFloat { (Self.nodeHeight + Self.gapY) * CGFloat(generation) + 10 }

    var body: some View {
        let columns = max(1, (nodes.map(\.column).max() ?? 0) + 1)
        let rows = max(1, (nodes.map(\.generation).max() ?? 0) + 1)
        let width = (Self.nodeWidth + Self.gapX) * CGFloat(columns)
        let height = (Self.nodeHeight + Self.gapY) * CGFloat(rows) - Self.gapY + 20
        ScrollView(.horizontal, showsIndicators: true) {
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    for e in edges {
                        var path = Path()
                        path.move(to: CGPoint(x: x(e.from.column) + Self.nodeWidth / 2, y: y(e.from.generation) + Self.nodeHeight))
                        path.addLine(to: CGPoint(x: x(e.to.column) + Self.nodeWidth / 2, y: y(e.to.generation)))
                        context.stroke(
                            path,
                            with: .color(e.color ?? Color(uiColor: .separator)),
                            style: StrokeStyle(lineWidth: e.width, dash: e.dashed ? [5, 4] : [])
                        )
                    }
                }
                .frame(width: width, height: height)
                ForEach(Array(edges.enumerated()), id: \.offset) { _, e in
                    if let label = e.label {
                        // A small plate behind the letters, as the web's halo stroke, so the line
                        // stays readable.
                        Text(label)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(e.labelColor ?? .primary)
                            .frame(minWidth: 28, minHeight: 22)
                            .background(Color(uiColor: .systemBackground), in: RoundedRectangle(cornerRadius: 4))
                            .position(
                                x: (x(e.from.column) + x(e.to.column)) / 2 + Self.nodeWidth / 2,
                                y: (y(e.from.generation) + Self.nodeHeight + y(e.to.generation)) / 2
                            )
                    }
                }
                ForEach(nodes) { n in
                    node(n)
                        .frame(width: Self.nodeWidth, height: Self.nodeHeight)
                        .offset(x: x(n.column), y: y(n.generation))
                }
            }
            .frame(width: width, height: height, alignment: .topLeading)
        }
    }
}

/// A box in either tree: the pedigree convention is a square for men, a pill for women.
struct PedigreeBox<Content: View>: View {
    let sex: String
    let border: Color
    var lineWidth: CGFloat = 1
    @ViewBuilder let content: () -> Content

    private var radius: CGFloat {
        switch Sex.of(sex) {
        case .male: return 4
        case .female: return Pedigree<EmptyView>.nodeHeight / 2
        case .unknown: return 8
        }
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content()
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: shape)
            .overlay(shape.strokeBorder(border, lineWidth: lineWidth))
            .contentShape(shape)
    }
}

/// Everyone as a pedigree (FamilyTree.tsx); a person with genotypes opens their report.
struct FamilyTree: View {
    let persons: [Person]
    let relationships: [Relationship]
    let counts: [String: Int]
    let onOpen: (Person) -> Void

    var body: some View {
        let nodes = Inheritance.layoutPedigree(persons, relationships)
        VStack(alignment: .leading, spacing: 8) {
            Pedigree(nodes: nodes, edges: PedigreeEdge.of(nodes)) { n in
                let p = n.person
                let snps = counts[p.id] ?? 0
                PedigreeBox(
                    sex: p.sex,
                    border: snps > 0 ? .accentColor : Color(uiColor: .separator),
                    lineWidth: snps > 0 ? 1.5 : 1
                ) {
                    VStack(spacing: 2) {
                        Text(p.displayName).font(.subheadline.weight(.semibold)).lineLimit(1)
                        Text(facts(p, snps))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                    }
                }
                .onTapGesture { if snps > 0 { onOpen(p) } }
                .accessibilityAddTraits(snps > 0 ? .isButton : [])
            }
            .padding(.horizontal, 8)
            if persons.count > 1 && relationships.isEmpty {
                Text(t("peoplePage.treeHint"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal)
            }
        }
    }

    private func facts(_ p: Person, _ snps: Int) -> String {
        var parts: [String] = []
        if let year = p.birthYear { parts.append(t("peoplePage.born", ["year": year])) }
        parts.append(snps > 0 ? t("peoplePage.snps", ["n": grouped(snps)]) : t("peoplePage.noGenotypes"))
        return parts.joined(separator: " · ")
    }
}
