/**
 * Static content pages.
 *
 * The privacy page states plainly what is and is not collected. It is short
 * because there is very little to say — which is the point.
 */
import { INTEGRATOR_INFO } from "../sim/integrators";

export function AboutPage() {
  return (
    <div>
      <h1>About</h1>

      <p>
        This is an interactive Newtonian n-body gravity simulator. It is built around
        one idea: that a simulation should show you how much to trust it.
      </p>

      <h2>How it works</h2>
      <p>
        The physics runs in a Web Worker, entirely off the main thread, on a
        structure-of-arrays layout of typed arrays. The renderer draws whatever the most
        recent snapshot contains. The two are decoupled, so a slow physics step cannot
        stall input handling, and a slow frame cannot alter the physics.
      </p>
      <p>
        Simulated time is driven by a fixed-timestep accumulator rather than by frames.
        That means the simulation advances at the same rate on a 60 Hz laptop and a 144
        Hz monitor — a difference that is easy to get wrong and surprisingly common.
      </p>

      <h2>Integrators</h2>
      <p>
        Three methods are available. The default is velocity Verlet, because it is
        symplectic: its energy error stays bounded over long integrations instead of
        growing steadily.
      </p>
      <table className="diagnostics">
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">Order</th>
            <th scope="col">Force evaluations</th>
            <th scope="col">Symplectic</th>
          </tr>
        </thead>
        <tbody>
          {INTEGRATOR_INFO.map((info) => (
            <tr key={info.name}>
              <th scope="row">{info.label}</th>
              <td className="value">{info.order}</td>
              <td className="value">{info.forceEvaluationsPerStep}</td>
              <td className="value">{info.symplectic ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Conservation diagnostics</h2>
      <p>
        Every scenario shows the relative drift in total energy and total angular
        momentum. In an exact integration neither would change at all, so the drift is a
        direct, honest measure of accumulated numerical error. When it grows large, the
        simulator says so rather than continuing to look convincing.
      </p>

      <h2>Where the numbers come from</h2>
      <p>
        Every scenario carries a citation naming the provider, the reference and the
        date the values were retrieved. Where a scenario is an idealisation — for
        example a coplanar model that starts each planet at its perihelion — that is
        stated on the scenario itself, not buried in a general disclaimer.
      </p>

      <h2>Accessibility</h2>
      <p>
        All controls are real buttons and form elements with accessible names, the tab
        sets implement the ARIA tabs pattern with arrow-key navigation, and the page
        never blocks zooming. The 3D view cannot be made equivalent for a non-visual
        user, so the same data is published as a live table of bodies alongside it, and
        state changes are announced. The data is fully accessible; the visualisation is
        an enhancement.
      </p>

      <h2>Prior art</h2>
      <p>
        Harmony of the Spheres by Darrell Huffman and contributors is prior art in this
        space. This project is a clean-room implementation and is not derived from it.
      </p>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div>
      <h1>Privacy</h1>

      <h2>What is collected</h2>
      <p>
        <strong>Nothing.</strong> This application has no analytics, no tracking pixels,
        no advertising, and no cookies. It makes no third-party network requests: there
        are no fonts, scripts or stylesheets loaded from anyone else’s server.
      </p>

      <h2>What stays on your device</h2>
      <p>
        Scenarios you save are stored in your own browser using IndexedDB. They are
        never uploaded. Clearing your browser’s site data removes them, and nobody else
        — us included — can read them.
      </p>

      <h2>Share links</h2>
      <p>
        A share link carries the whole scenario in the URL’s fragment — the part after
        the <code>#</code>. Browsers never transmit the fragment to a server, so sharing
        a scenario does not send it to us, to a host, or to any proxy in between. There
        is no server-side record of anything you create.
      </p>

      <h2>Advertising</h2>
      <p>
        There is none, anywhere in this application, and there is none in the simulation
        view in particular.
      </p>
    </div>
  );
}
